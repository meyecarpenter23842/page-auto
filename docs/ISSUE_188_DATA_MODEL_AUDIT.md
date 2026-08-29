# Issue #188 — Data model audit: canonical posts + context bindings

Status: implementation baseline for the first data-model batch of Issue #188.

Precedence: read together with `PROJECT_PRINCIPLES.md`, `PROJECT_PLAN.md`, `ARCHITECTURE.md`, `ISSUE_188_HANDOFF.md` and Issue #188. If older K4.5.1/K4.5.2 wording describes `content_sets/content_items`, Page post libraries, or `contentSetId` as the target architecture, the canonical-post invariant in `PROJECT_PRINCIPLES.md` supersedes it.

## 1. Audit conclusion

PAGE-AUTO currently has multiple physical representations of post content:

- app-level K4.5.1 library: `content_sets` + `content_items` where `content_sets.page_tab_id IS NULL`;
- Page compatibility library: `page_tab_posts`;
- older Page compatibility data: `content_sets.page_tab_id IS NOT NULL` + `content_items` + `image_sources`;
- Scenario `post`: a `contentSetId` reference in `scenario_actions.config_json`;
- legacy Scenario `group_post`: inline `content` and media fields in `scenario_actions.config_json`;
- immutable runtime/history snapshots such as `runs.snapshot_json` and `page_wall_jobs.content/image_paths_json`.

The target is one canonical post identity:

```text
posts
  #101 #102 #103 ...

Page A -> page_tab_post_bindings -> #101 #103
Page B -> page_tab_post_bindings -> #101 #105
Scenario action X -> scenario_action_post_bindings -> #101 #104
```

Content/variants/base media live only in `posts`. Consumer state (`enabled`, `sort_order`, sequential/random mode, target IDs, delays, etc.) stays with the consumer/binding.

## 2. What is source config vs immutable snapshot

### Source/config that must migrate

| Current source | Current ownership | Canonical target |
| --- | --- | --- |
| `content_sets` global + `content_items` | K4.5.1 global library | `posts` + `post_collections` + collection bindings |
| `page_tab_posts` | physical Page copy | `posts` + `page_tab_post_bindings` |
| Page legacy `content_sets/content_items/image_sources` | compatibility fallback | `posts` + `page_tab_post_bindings` |
| Scenario `post.contentSetId` | reference to old set model | `scenario_action_post_bindings` |
| Scenario `group_post.content` + media | inline Scenario-owned copy | `posts` + `scenario_action_post_bindings` |

### Snapshot/history that must not become a live binding

- `runs.snapshot_json` stays immutable run material.
- `run_items` stays Group/run queue state.
- `page_wall_jobs.content` and `image_paths_json` stay the frozen scheduled-job payload.
- execution logs/evidence stay historical data.

Editing/unlinking a canonical post after Start or after a wall job has been scheduled must not mutate the already-created snapshot/job.

## 3. Canonical schema

### `posts`

One row is one canonical post identity.

```text
id
name
variants_json
image_folder_path
image_mode
images_per_post
missing_policy
created_at
updated_at
```

`posts` intentionally does **not** own:

- Page/Scenario ID;
- `enabled` for a consumer;
- `sort_order` for a consumer;
- sequential/random selection mode;
- posts/account or delay;
- Group target list;
- Page UID;
- consumer-specific edit overrides.

Image mode must support the union required by existing data: `sequential`, `random`, `filename_match`.

### `post_collections`

Collections preserve the useful grouping currently represented by global `content_sets`, without making a collection a second post store.

```text
post_collections
  id
  name
  created_at
  updated_at

post_collection_bindings
  collection_id
  post_id
  enabled
  sort_order
```

A collection is organization/selection metadata. Post content still lives once in `posts`.

### `page_tab_post_bindings`

```text
page_tab_id -> page_tabs.id ON DELETE CASCADE
post_id     -> posts.id     ON DELETE RESTRICT
enabled
sort_order

name_override                  nullable
variants_override_json         nullable
image_folder_path_override     nullable
image_mode_override            nullable
images_per_post_override       nullable
missing_policy_override        nullable
```

`UNIQUE(page_tab_id, post_id)` prevents accidental duplicate binding of the same canonical post to one Page.

### `scenario_action_post_bindings`

Binding belongs to `scenario_action_id`, not only `scenario_id`, because one Scenario can contain several publishing actions with different post lists.

```text
scenario_action_id -> scenario_actions.id ON DELETE CASCADE
post_id            -> posts.id            ON DELETE RESTRICT
enabled
sort_order
same nullable override fields as Page binding
```

## 4. Edit/delete semantics

### Create inside a context

`+ Bài mới` must eventually be one transaction:

1. insert canonical `posts` row;
2. insert binding for the current Page/Scenario/business context.

### Choose from library

Only insert a binding to an existing `post_id`. Never copy content into another post row.

### Remove from Page/Scenario

Delete only the context binding.

### Edit inside Page/Scenario

A context-local edit writes binding overrides. It does not mutate the canonical post and therefore does not silently change other contexts.

### Edit in the Bài viết tab

This is the operation that edits the canonical `posts` row. Contexts without an override for the edited field will resolve the new canonical value for their next run.

### Delete canonical post

Default policy is RESTRICT while any collection/Page/Scenario binding still points to the post. The database FKs enforce the safe baseline. A future explicit “delete permanently + unlink everywhere” command, if added, must be a separate confirmed transaction.

## 5. Legacy migration mapping

The first migration is additive. It creates/backfills canonical tables but does not drop or rewrite the legacy consumer/runtime paths yet.

### A. Global `content_sets/content_items`

For every `content_sets.page_tab_id IS NULL`:

- create one `post_collections` row;
- create one canonical `posts` row per `content_items` row;
- create collection binding preserving `enabled` and `sort_order`;
- preserve name, variants (fall back to legacy `content`), image config and timestamps.

Scenario actions referencing that legacy content set reuse these same newly-created canonical post IDs. They do not receive copies.

### B. Page with `page_tab_posts`

`page_tab_posts` is authoritative over the older Page mirror.

For each Page post:

- create one canonical post;
- create Page binding preserving enabled/order;
- preserve variants/media.

Do **not** also migrate that Page's mirrored `content_sets(page_tab_id)/content_items/image_sources`, otherwise the same effective Page data would be duplicated.

### C. Page without `page_tab_posts`

Use the same fallback semantics as the current `PageTabPostRepository.fromLegacy()`:

- read Page `content_sets/content_items`;
- use `image_sources` as the Page image config;
- create canonical posts + Page bindings;
- preserve legacy random mode by moving it to `page_tabs.post_selection_mode` (`random`; otherwise `sequential`).

### D. Scenario `post`

For a valid legacy `contentSetId`:

- resolve the canonical post IDs backfilled from that set's items;
- create `scenario_action_post_bindings` in the same order;
- copy the legacy item enabled state to each action binding;
- keep `selectionMode`, targets, counts and delays in action config.

The initial additive batch does not remove `contentSetId` from `config_json`; consumer cutover happens in a later batch.

### E. Scenario `group_post`

For valid legacy inline content:

- parse `|` variants with the existing escape semantics (`\\|` means a literal pipe);
- create one canonical post for the action;
- move its content/base media into that post;
- create one Scenario action binding;
- keep Group targets, post mode, counts and delays in action config until the consumer cutover batch.

## 6. Identity/deduplication rule

Migration must not guess identity from equal text/media.

Two old rows with identical content remain two canonical posts unless the old model already had a stored reference proving they were the same entity. This avoids accidentally merging independently edited posts.

Consequences:

- two different global `content_items` rows -> two canonical posts;
- copied Page A/Page B rows with no historical source reference -> two canonical posts during migration;
- Scenario `post` referencing a global set -> reuses the same canonical posts because an explicit legacy reference exists.

Future “Chọn từ thư viện” creates real shared identity from that point forward.

## 7. Transitional provenance

The additive migration keeps small compatibility maps:

```text
post_legacy_sources
  (source_kind, source_id) -> post_id

post_collection_legacy_sources
  content_set_id -> collection_id
```

These are migration/cutover aids, not a second content store. They make legacy-to-canonical identity auditable and allow the repository/consumer migration batch to reconcile safely before legacy cleanup. They can be removed in the final compatibility-cleanup migration once no released/runtime path depends on the legacy model.

## 8. Runtime invariant

The target resolution flow is:

```text
canonical post
+ context binding
+ nullable context overrides
        |
        v
resolved RunSnapshotPost
        |
        v
immutable run/job snapshot
        |
        v
existing worker/runtime
```

Worker code must not query the live canonical library in the middle of a run.

The current Page run path already serializes post material into `runs.snapshot_json`; Scenario `post` already prepares a copied post list before execution. Those semantics should be retained during consumer migration.

## 9. Backup/restore impact (later batch)

Current backup serializes global content libraries and Page post libraries as separate physical content. That loses future shared identity.

A later backup-format batch must export canonical posts once and export context bindings by portable backup key, then restore posts first and bindings second. Old backup v1 files must remain restorable.

Backup format is intentionally not changed in the initial schema/backfill batch.

## 10. First implementation batch boundary

Included:

- canonical schema;
- additive migration/backfill;
- migration tests;
- schema version registration;
- this audit document.

Not included:

- Page/Scenario repository cutover;
- IPC/UI changes;
- new `+ Bài mới` / `Chọn từ thư viện` UI;
- backup format rewrite;
- legacy table drops;
- Facebook selector/runtime changes;
- Group anti-duplicate changes.

## 11. Regression required before consumer cutover

1. Global content item -> one canonical post, preserving variants/media.
2. Scenario `post` reuses canonical IDs from its referenced legacy set.
3. Disabled/order state survives into collection/Scenario bindings.
4. Page with `page_tab_posts` does not also migrate its legacy mirror.
5. Page legacy fallback preserves content, image config and random/sequential mode.
6. Legacy inline `group_post` preserves escaped variants and media config.
7. Migration is idempotent.
8. Legacy rows remain present after the additive migration.
9. Bound canonical post cannot be deleted accidentally (`ON DELETE RESTRICT`).
10. Consumer cutover later resolves canonical + overrides into the same immutable run snapshot shape used today.
