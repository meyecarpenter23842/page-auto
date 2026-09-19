import type Database from 'better-sqlite3'
import { ACCOUNT_IMPORT_FIELDS, type AccountColumnLayout, type AccountImportMapping } from '../../shared/accounts'
import {
  CONFIG_BACKUP_FORMAT,
  CONFIG_BACKUP_LEGACY_VERSION,
  CONFIG_BACKUP_VERSION,
  type ConfigBackupCanonicalPost,
  type ConfigBackupContentLibrary,
  type ConfigBackupPageTab,
  type ConfigBackupPayload,
  type ConfigBackupPostBinding,
  type ConfigBackupPostCollection,
  type ConfigBackupPostOverrides,
  type ConfigBackupRestoreResult,
  type ConfigBackupScenario,
  type ConfigBackupSummary
} from '../../shared/configBackup'
import type { ContentLibraryImageConfig, ContentLibraryItemDraft } from '../../shared/contentLibrary'
import {
  IMAGE_MODES,
  MISSING_IMAGE_POLICIES,
  POST_SELECTION_MODES,
  formatPostVariantText,
  parsePostVariantText,
  type ImageMode,
  type MissingImagePolicy,
  type PageTabImageConfig,
  type PageTabPostInput,
  type PostSelectionMode
} from '../../shared/pageTabs'
import { SCENARIO_ACTION_CATEGORIES, type ScenarioActionCategory } from '../../shared/scenarios'
import { AccountRepository } from '../database/accountRepository'
import {
  CanonicalPostRepository,
  PageTabPostBindingRepository,
  ScenarioActionPostBindingRepository,
  type CanonicalPostRecord,
  type ResolvedPostBinding
} from '../database/canonicalPostRepository'
import { ContentLibraryRepository } from '../database/contentLibraryRepository'
import { LegacyCanonicalPostBridge } from '../database/legacyCanonicalPostBridge'
import { PageTabPostRepository } from '../database/pageTabPostRepository'
import { PageTabRepository } from '../database/pageTabRepository'
import { ScenarioRepository } from '../database/scenarioRepository'

const SECRET_EXCLUDES = [
  'password',
  'cookie/session',
  '2FA secret',
  'email password',
  'proxy password',
  'browser profiles',
  'runtime logs/screenshots'
]

const EMPTY_OVERRIDES: ConfigBackupPostOverrides = {
  name: null,
  variants: null,
  imageFolderPath: null,
  imageMode: null,
  imagesPerPost: null,
  missingPolicy: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isImportMapping(value: unknown): value is AccountImportMapping {
  if (!Array.isArray(value)) return false
  return value.every((item) => item === 'ignore' || (
    typeof item === 'string' && (ACCOUNT_IMPORT_FIELDS as readonly string[]).includes(item)
  ))
}

function isColumnLayout(value: unknown): value is AccountColumnLayout {
  if (!isRecord(value)) return false
  return Array.isArray(value.order)
    && value.order.every((item) => typeof item === 'string')
    && Array.isArray(value.hidden)
    && value.hidden.every((item) => typeof item === 'string')
    && isRecord(value.widths)
    && Object.values(value.widths).every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isPostInput(value: unknown): value is PageTabPostInput {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.enabled !== 'boolean') return false
  if (typeof value.sortOrder !== 'number' || !Number.isInteger(value.sortOrder) || !Array.isArray(value.variants) || !value.variants.every((item) => typeof item === 'string')) return false
  if (!isRecord(value.image)) return false
  return typeof value.image.folderPath === 'string'
    && typeof value.image.mode === 'string'
    && typeof value.image.imagesPerPost === 'number'
    && typeof value.image.missingPolicy === 'string'
}

function isContentLibraryItem(value: unknown): value is ContentLibraryItemDraft {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.enabled !== 'boolean') return false
  if (!Array.isArray(value.variants) || !value.variants.every((item) => typeof item === 'string')) return false
  if (!isRecord(value.image)) return false
  return typeof value.image.folderPath === 'string'
    && typeof value.image.mode === 'string'
    && typeof value.image.imagesPerPost === 'number'
    && typeof value.image.missingPolicy === 'string'
}

function isImage(value: unknown): value is PageTabImageConfig {
  if (!isRecord(value)) return false
  return typeof value.folderPath === 'string'
    && typeof value.mode === 'string'
    && IMAGE_MODES.includes(value.mode as ImageMode)
    && typeof value.imagesPerPost === 'number'
    && Number.isSafeInteger(value.imagesPerPost)
    && value.imagesPerPost > 0
    && typeof value.missingPolicy === 'string'
    && MISSING_IMAGE_POLICIES.includes(value.missingPolicy as MissingImagePolicy)
}

function isOverrides(value: unknown): value is ConfigBackupPostOverrides {
  if (!isRecord(value)) return false
  const variantsOk = value.variants === null || (Array.isArray(value.variants) && value.variants.every((item) => typeof item === 'string'))
  const imageModeOk = value.imageMode === null || (typeof value.imageMode === 'string' && IMAGE_MODES.includes(value.imageMode as ImageMode))
  const missingOk = value.missingPolicy === null || (typeof value.missingPolicy === 'string' && MISSING_IMAGE_POLICIES.includes(value.missingPolicy as MissingImagePolicy))
  const imagesOk = value.imagesPerPost === null || (typeof value.imagesPerPost === 'number' && Number.isSafeInteger(value.imagesPerPost) && value.imagesPerPost > 0)
  return (value.name === null || typeof value.name === 'string')
    && variantsOk
    && (value.imageFolderPath === null || typeof value.imageFolderPath === 'string')
    && imageModeOk
    && imagesOk
    && missingOk
}

function isBinding(value: unknown): value is ConfigBackupPostBinding {
  return isRecord(value)
    && typeof value.postKey === 'string'
    && typeof value.enabled === 'boolean'
    && typeof value.sortOrder === 'number'
    && Number.isInteger(value.sortOrder)
    && isOverrides(value.overrides)
}

function validateCommon(parsed: Record<string, unknown>): void {
  if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.pageTabs) || !Array.isArray(parsed.importPresets)) {
    throw new Error('File backup thiếu dữ liệu cấu hình bắt buộc.')
  }
  if (parsed.accountColumnLayout !== null && !isColumnLayout(parsed.accountColumnLayout)) {
    throw new Error('Column layout trong backup không hợp lệ.')
  }
  for (const preset of parsed.importPresets) {
    if (!isRecord(preset) || typeof preset.name !== 'string' || typeof preset.delimiter !== 'string' || !isImportMapping(preset.mapping)) {
      throw new Error('Import preset trong backup không hợp lệ.')
    }
  }
}

function createKey(prefix: string, ordinal: number): string {
  return `${prefix}-${ordinal + 1}`
}

function v1PostFromInput(post: PageTabPostInput): Omit<ConfigBackupCanonicalPost, 'key'> {
  return { name: post.name, variants: [...post.variants], image: { ...post.image } }
}

function upgradeV1(parsed: Record<string, unknown>): ConfigBackupPayload {
  validateCommon(parsed)
  const posts: ConfigBackupCanonicalPost[] = []
  const postCollections: ConfigBackupPostCollection[] = []
  let postOrdinal = 0

  const nextPost = (draft: Omit<ConfigBackupCanonicalPost, 'key'>): string => {
    const key = createKey('post', postOrdinal++)
    posts.push({ key, ...draft, variants: [...draft.variants], image: { ...draft.image } })
    return key
  }

  const rawLibraries = parsed.contentLibraries
  if (rawLibraries !== undefined) {
    if (!Array.isArray(rawLibraries)) throw new Error('Thư viện Bài viết trong backup v1 không hợp lệ.')
    rawLibraries.forEach((library, collectionIndex) => {
      if (!isRecord(library) || typeof library.name !== 'string' || !Array.isArray(library.items) || !library.items.every(isContentLibraryItem)) {
        throw new Error('Thư viện Bài viết trong backup v1 không hợp lệ.')
      }
      const source = library as unknown as ConfigBackupContentLibrary
      postCollections.push({
        key: createKey('collection', collectionIndex),
        name: source.name,
        bindings: source.items.map((item, index) => ({
          postKey: nextPost({ name: item.name, variants: [...item.variants], image: { ...item.image } }),
          enabled: item.enabled,
          sortOrder: index
        }))
      })
    })
  }

  const rawPageTabs = parsed.pageTabs as unknown[]
  const pageTabs: ConfigBackupPageTab[] = rawPageTabs.map((rawTab, tabIndex) => {
    if (!isRecord(rawTab) || typeof rawTab.name !== 'string' || typeof rawTab.pageUid !== 'string') {
      throw new Error('Page Tab trong backup v1 không hợp lệ.')
    }
    if (!Array.isArray(rawTab.accounts) || !Array.isArray(rawTab.schedules) || !Array.isArray(rawTab.groupUids) || !Array.isArray(rawTab.contents)) {
      throw new Error(`Page Tab "${rawTab.name}" thiếu cấu hình bắt buộc.`)
    }
    const rawLibrary = rawTab.postLibrary
    let postMode: PostSelectionMode = 'sequential'
    let postBindings: ConfigBackupPostBinding[] = []
    if (rawLibrary !== undefined) {
      if (!isRecord(rawLibrary)
        || typeof rawLibrary.mode !== 'string'
        || !POST_SELECTION_MODES.includes(rawLibrary.mode as PostSelectionMode)
        || !Array.isArray(rawLibrary.posts)
        || !rawLibrary.posts.every(isPostInput)) {
        throw new Error('Post Library trong backup v1 không hợp lệ.')
      }
      postMode = rawLibrary.mode as PostSelectionMode
      postBindings = (rawLibrary.posts as PageTabPostInput[]).map((post, index) => {
        const postKey = nextPost(v1PostFromInput(post))
        return { postKey, enabled: post.enabled, sortOrder: index, overrides: { ...EMPTY_OVERRIDES } }
      })
    }
    return {
      key: createKey('page', tabIndex),
      name: rawTab.name,
      pageUid: rawTab.pageUid,
      rotation: rawTab.rotation as ConfigBackupPageTab['rotation'],
      accounts: rawTab.accounts as ConfigBackupPageTab['accounts'],
      schedules: rawTab.schedules as ConfigBackupPageTab['schedules'],
      groupUids: rawTab.groupUids as string[],
      contentMode: rawTab.contentMode as ConfigBackupPageTab['contentMode'],
      contents: rawTab.contents as string[],
      image: rawTab.image as PageTabImageConfig,
      postMode,
      postBindings
    }
  })

  return {
    format: CONFIG_BACKUP_FORMAT,
    version: CONFIG_BACKUP_VERSION,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
    security: {
      containsSecrets: false,
      excludes: isRecord(parsed.security) && Array.isArray(parsed.security.excludes)
        ? parsed.security.excludes.filter((item): item is string => typeof item === 'string')
        : [...SECRET_EXCLUDES]
    },
    accounts: parsed.accounts as ConfigBackupPayload['accounts'],
    pageTabs,
    posts,
    postCollections,
    scenarios: [],
    importPresets: parsed.importPresets as ConfigBackupPayload['importPresets'],
    accountColumnLayout: parsed.accountColumnLayout as AccountColumnLayout | null
  }
}

function validateV2(parsed: Record<string, unknown>): ConfigBackupPayload {
  validateCommon(parsed)
  if (!Array.isArray(parsed.posts) || !Array.isArray(parsed.postCollections) || !Array.isArray(parsed.scenarios)) {
    throw new Error('Backup v2 thiếu dữ liệu bài viết canonical hoặc Kịch Bản.')
  }
  const postKeys = new Set<string>()
  for (const post of parsed.posts) {
    if (!isRecord(post) || typeof post.key !== 'string' || !post.key.trim() || postKeys.has(post.key)
      || typeof post.name !== 'string' || !Array.isArray(post.variants) || !post.variants.every((item) => typeof item === 'string') || !isImage(post.image)) {
      throw new Error('Bài viết canonical trong backup v2 không hợp lệ.')
    }
    postKeys.add(post.key)
  }
  const checkBinding = (binding: unknown) => {
    if (!isBinding(binding) || !postKeys.has(binding.postKey)) throw new Error('Liên kết bài viết trong backup v2 không hợp lệ.')
  }
  const checkBindingList = (bindings: unknown[]) => {
    const seen = new Set<string>()
    for (const binding of bindings) {
      checkBinding(binding)
      const key = (binding as ConfigBackupPostBinding).postKey
      if (seen.has(key)) throw new Error(`Một context trong backup v2 gắn trùng bài viết “${key}”.`)
      seen.add(key)
    }
  }
  for (const collection of parsed.postCollections) {
    if (!isRecord(collection) || typeof collection.key !== 'string' || typeof collection.name !== 'string' || !Array.isArray(collection.bindings)) {
      throw new Error('Nhóm bài viết trong backup v2 không hợp lệ.')
    }
    const collectionPostKeys = new Set<string>()
    collection.bindings.forEach((binding) => {
      if (!isRecord(binding) || typeof binding.postKey !== 'string' || !postKeys.has(binding.postKey)
        || typeof binding.enabled !== 'boolean' || typeof binding.sortOrder !== 'number' || collectionPostKeys.has(binding.postKey)) {
        throw new Error('Liên kết nhóm bài viết trong backup v2 không hợp lệ.')
      }
      collectionPostKeys.add(binding.postKey)
    })
  }
  for (const rawTab of parsed.pageTabs as unknown[]) {
    if (!isRecord(rawTab) || typeof rawTab.key !== 'string' || typeof rawTab.name !== 'string' || typeof rawTab.pageUid !== 'string'
      || typeof rawTab.postMode !== 'string' || !POST_SELECTION_MODES.includes(rawTab.postMode as PostSelectionMode)
      || !Array.isArray(rawTab.postBindings)) {
      throw new Error('Page Tab trong backup v2 không hợp lệ.')
    }
    checkBindingList(rawTab.postBindings)
  }
  for (const scenario of parsed.scenarios) {
    if (!isRecord(scenario) || typeof scenario.key !== 'string' || typeof scenario.name !== 'string' || !Array.isArray(scenario.actions)) {
      throw new Error('Kịch Bản trong backup v2 không hợp lệ.')
    }
    for (const action of scenario.actions) {
      if (!isRecord(action) || typeof action.key !== 'string' || typeof action.actionType !== 'string'
        || typeof action.label !== 'string' || typeof action.category !== 'string'
        || !SCENARIO_ACTION_CATEGORIES.includes(action.category as ScenarioActionCategory)
        || typeof action.enabled !== 'boolean' || typeof action.configJson !== 'string'
        || !Array.isArray(action.postBindings)) {
        throw new Error('Action Kịch Bản trong backup v2 không hợp lệ.')
      }
      checkBindingList(action.postBindings)
    }
  }
  return parsed as unknown as ConfigBackupPayload
}

function parseBackup(rawText: string): ConfigBackupPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText) as unknown
  } catch {
    throw new Error('File backup không phải JSON hợp lệ.')
  }
  if (!isRecord(parsed) || parsed.format !== CONFIG_BACKUP_FORMAT) {
    throw new Error('File không đúng định dạng PAGE-AUTO config backup.')
  }
  if (parsed.version === CONFIG_BACKUP_LEGACY_VERSION) return upgradeV1(parsed)
  if (parsed.version !== CONFIG_BACKUP_VERSION) throw new Error('Phiên bản PAGE-AUTO config backup không được hỗ trợ.')
  return validateV2(parsed)
}

function summary(payload: ConfigBackupPayload): ConfigBackupSummary {
  return {
    accounts: payload.accounts.length,
    pageTabs: payload.pageTabs.length,
    contentLibraries: payload.postCollections.length,
    canonicalPosts: payload.posts.length,
    scenarios: payload.scenarios.length,
    importPresets: payload.importPresets.length,
    hasColumnLayout: payload.accountColumnLayout !== null
  }
}

function cloneOverrides(binding: ResolvedPostBinding): ConfigBackupPostOverrides {
  return {
    name: binding.overrides.name,
    variants: binding.overrides.variants === null ? null : [...binding.overrides.variants],
    imageFolderPath: binding.overrides.imageFolderPath,
    imageMode: binding.overrides.imageMode,
    imagesPerPost: binding.overrides.imagesPerPost,
    missingPolicy: binding.overrides.missingPolicy
  }
}

function backupBinding(binding: ResolvedPostBinding, postKey: string, index: number): ConfigBackupPostBinding {
  return {
    postKey,
    enabled: binding.enabled,
    sortOrder: index,
    overrides: cloneOverrides(binding)
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const value = raw.trim() ? JSON.parse(raw) as unknown : {}
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function numericConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringConfig(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key]
  return typeof value === 'string' ? value : fallback
}

function legacyImage(image: PageTabImageConfig): ContentLibraryImageConfig {
  return {
    folderPath: image.folderPath,
    mode: image.mode === 'random' ? 'random' : 'sequential',
    imagesPerPost: image.imagesPerPost,
    missingPolicy: image.missingPolicy
  }
}

class ExportPostRegistry {
  readonly posts: ConfigBackupCanonicalPost[] = []
  readonly keyByPostId = new Map<number, string>()
  private readonly indexByKey = new Map<string, number>()
  private ordinal = 0

  constructor(records: readonly CanonicalPostRecord[]) {
    for (const record of records) {
      const key = this.nextKey()
      this.keyByPostId.set(record.id, key)
      this.indexByKey.set(key, this.posts.length)
      this.posts.push({ key, name: record.name, variants: [...record.variants], image: { ...record.image } })
    }
  }

  addDraft(draft: Omit<ConfigBackupCanonicalPost, 'key'>): string {
    const key = this.nextKey()
    this.indexByKey.set(key, this.posts.length)
    this.posts.push({ key, name: draft.name, variants: [...draft.variants], image: { ...draft.image } })
    return key
  }

  replace(key: string, draft: Omit<ConfigBackupCanonicalPost, 'key'>): void {
    const index = this.indexByKey.get(key)
    if (index === undefined) return
    this.posts[index] = { key, name: draft.name, variants: [...draft.variants], image: { ...draft.image } }
  }

  requireKey(postId: number): string {
    const key = this.keyByPostId.get(postId)
    if (!key) throw new Error(`Không tìm thấy portable key cho bài viết #${postId}.`)
    return key
  }

  private nextKey(): string {
    return createKey('post', this.ordinal++)
  }
}

export class ConfigBackupService {
  private readonly accounts: AccountRepository
  private readonly pageTabs: PageTabRepository
  private readonly legacyPosts: PageTabPostRepository
  private readonly pageBindings: PageTabPostBindingRepository
  private readonly canonicalPosts: CanonicalPostRepository
  private readonly contentLibrary: ContentLibraryRepository
  private readonly scenarios: ScenarioRepository
  private readonly scenarioBindings: ScenarioActionPostBindingRepository
  private readonly legacyBridge: LegacyCanonicalPostBridge

  constructor(private readonly client: Database.Database) {
    this.accounts = new AccountRepository(client)
    this.pageTabs = new PageTabRepository(client)
    this.legacyPosts = new PageTabPostRepository(client)
    this.pageBindings = new PageTabPostBindingRepository(client)
    this.canonicalPosts = new CanonicalPostRepository(client)
    this.contentLibrary = new ContentLibraryRepository(client)
    this.scenarios = new ScenarioRepository(client)
    this.scenarioBindings = new ScenarioActionPostBindingRepository(client)
    this.legacyBridge = new LegacyCanonicalPostBridge(client)
  }

  createPayload(appVersion: string): ConfigBackupPayload {
    this.legacyBridge.reconcileAllPages()
    this.legacyBridge.syncAllGlobalSets()

    const registry = new ExportPostRegistry(this.canonicalPosts.list().sort((a, b) => a.id - b.id))
    const legacySetCollections = new Map<number, { key: string; bindings: ConfigBackupPostCollection['bindings'] }>()
    const mappedCollectionIds = new Set<number>()
    const postCollections: ConfigBackupPostCollection[] = []

    const mappedSets = this.client.prepare(`
      SELECT content_set_id AS contentSetId, collection_id AS collectionId
      FROM post_collection_legacy_sources
    `).all() as Array<{ contentSetId: number; collectionId: number }>
    const collectionKeyById = new Map<number, string>()
    const canonicalCollections = this.client.prepare(`
      SELECT id, name FROM post_collections ORDER BY id
    `).all() as Array<{ id: number; name: string }>
    canonicalCollections.forEach((collection, index) => collectionKeyById.set(collection.id, createKey('collection', index)))

    const legacySets = this.contentLibrary.list().sort((a, b) => a.id - b.id)
    for (const setSummary of legacySets) {
      const details = this.contentLibrary.get(setSummary.id)
      if (!details) continue
      const mapped = mappedSets.find((item) => item.contentSetId === details.id)
      const key = mapped ? collectionKeyById.get(mapped.collectionId) ?? createKey('collection', postCollections.length) : createKey('collection', canonicalCollections.length + postCollections.length)
      if (mapped) mappedCollectionIds.add(mapped.collectionId)
      const bindings = details.items.map((item, index) => {
        const source = this.client.prepare(`
          SELECT post_id AS postId FROM post_legacy_sources
          WHERE source_kind = 'content_item' AND source_id = ?
        `).get(item.id) as { postId: number } | undefined
        let postKey: string
        if (source && registry.keyByPostId.has(source.postId)) {
          postKey = registry.requireKey(source.postId)
          registry.replace(postKey, { name: item.name, variants: [...item.variants], image: { ...item.image } })
        } else {
          postKey = registry.addDraft({ name: item.name, variants: [...item.variants], image: { ...item.image } })
        }
        return { postKey, enabled: item.enabled, sortOrder: index }
      })
      postCollections.push({ key, name: details.name, bindings })
      legacySetCollections.set(details.id, { key, bindings })
    }

    for (const collection of canonicalCollections) {
      if (mappedCollectionIds.has(collection.id)) continue
      const bindings = this.client.prepare(`
        SELECT post_id AS postId, enabled, sort_order AS sortOrder
        FROM post_collection_bindings
        WHERE collection_id = ?
        ORDER BY sort_order, id
      `).all(collection.id) as Array<{ postId: number; enabled: number; sortOrder: number }>
      postCollections.push({
        key: collectionKeyById.get(collection.id) ?? createKey('collection', postCollections.length),
        name: collection.name,
        bindings: bindings.map((binding, index) => ({
          postKey: registry.requireKey(binding.postId),
          enabled: binding.enabled === 1,
          sortOrder: index
        }))
      })
    }

    const accounts = this.accounts.list().map((account) => ({ uid: account.uid, name: account.name, category: account.category }))
    const pageTabs = this.pageTabs.list().map((tabSummary, tabIndex): ConfigBackupPageTab => {
      const tab = this.pageTabs.get(tabSummary.id)
      if (!tab) throw new Error(`Không thể đọc Page Tab #${tabSummary.id} để backup.`)
      const currentLibrary = this.legacyPosts.get(tab.id)
      const canonicalBindings = this.pageBindings.list(tab.id)
      const postBindings = canonicalBindings.length
        ? canonicalBindings.map((binding, index) => backupBinding(binding, registry.requireKey(binding.postId), index))
        : currentLibrary.posts.map((post, index) => ({
            postKey: registry.addDraft({ name: post.name, variants: [...post.variants], image: { ...post.image } }),
            enabled: post.enabled,
            sortOrder: index,
            overrides: { ...EMPTY_OVERRIDES }
          }))
      return {
        key: createKey('page', tabIndex),
        name: tab.name,
        pageUid: tab.pageUid,
        rotation: { ...tab.rotation },
        accounts: tab.accounts.map((account) => ({ uid: account.uid, enabled: account.enabled, sortOrder: account.sortOrder, postsPerTurn: account.postsPerTurn })),
        schedules: tab.schedules.map((schedule) => ({
          dayOfWeek: schedule.dayOfWeek,
          startMinute: schedule.startMinute,
          endMinute: schedule.endMinute,
          enabled: schedule.enabled,
          sortOrder: schedule.sortOrder
        })),
        groupUids: [...tab.groupUids],
        contentMode: tab.contentMode,
        contents: [...tab.contents],
        image: { ...tab.image },
        postMode: currentLibrary.mode,
        postBindings
      }
    })

    const scenarios = this.scenarios.list().sort((a, b) => a.id - b.id).map((summaryItem, scenarioIndex): ConfigBackupScenario => {
      const details = this.scenarios.get(summaryItem.id)
      if (!details) throw new Error(`Không thể đọc Kịch Bản #${summaryItem.id} để backup.`)
      return {
        key: createKey('scenario', scenarioIndex),
        name: details.name,
        randomActionOrder: details.randomActionOrder,
        runtimeLimitMinutes: details.runtimeLimitMinutes,
        actions: details.actions.map((action, actionIndex) => {
          const canonicalBindings = this.scenarioBindings.list(action.id)
          let postBindings: ConfigBackupPostBinding[] = canonicalBindings.map((binding, index) => backupBinding(binding, registry.requireKey(binding.postId), index))
          if (!postBindings.length && action.actionType === 'post') {
            const config = parseConfig(action.configJson)
            const contentSetId = Math.floor(numericConfig(config, 'contentSetId', 0))
            const source = legacySetCollections.get(contentSetId)
            if (source) {
              postBindings = source.bindings.map((binding, index) => ({
                postKey: binding.postKey,
                enabled: binding.enabled,
                sortOrder: index,
                overrides: { ...EMPTY_OVERRIDES }
              }))
            }
          } else if (!postBindings.length && action.actionType === 'group_post') {
            const config = parseConfig(action.configJson)
            const variants = parsePostVariantText(stringConfig(config, 'content'))
            const folderPath = stringConfig(config, 'imageFolderPath')
            if (variants.length || folderPath.trim()) {
              const rawMode = stringConfig(config, 'imageMode', 'sequential')
              const rawMissing = stringConfig(config, 'missingPolicy', 'text_only')
              const image: PageTabImageConfig = {
                folderPath,
                mode: IMAGE_MODES.includes(rawMode as ImageMode) ? rawMode as ImageMode : 'sequential',
                imagesPerPost: Math.max(1, Math.floor(numericConfig(config, 'imagesPerPost', 1))),
                missingPolicy: MISSING_IMAGE_POLICIES.includes(rawMissing as MissingImagePolicy) ? rawMissing as MissingImagePolicy : 'text_only'
              }
              postBindings = [{
                postKey: registry.addDraft({ name: action.label || 'Scenario group_post', variants, image }),
                enabled: true,
                sortOrder: 0,
                overrides: { ...EMPTY_OVERRIDES }
              }]
            }
          }
          return {
            key: `${createKey('scenario', scenarioIndex)}-action-${actionIndex + 1}`,
            actionType: action.actionType,
            label: action.label,
            category: action.category,
            enabled: action.enabled,
            configJson: action.configJson,
            postBindings
          }
        })
      }
    })

    return {
      format: CONFIG_BACKUP_FORMAT,
      version: CONFIG_BACKUP_VERSION,
      appVersion,
      exportedAt: Date.now(),
      security: { containsSecrets: false, excludes: [...SECRET_EXCLUDES] },
      accounts,
      pageTabs,
      posts: registry.posts,
      postCollections,
      scenarios,
      importPresets: this.accounts.listImportPresets().map((preset) => ({ name: preset.name, delimiter: preset.delimiter, mapping: [...preset.mapping] })),
      accountColumnLayout: this.accounts.getColumnLayout('accounts')
    }
  }

  getSummary(payload: ConfigBackupPayload): ConfigBackupSummary {
    return summary(payload)
  }

  restoreFromJson(rawText: string, filePath: string | null = null): ConfigBackupRestoreResult {
    const payload = parseBackup(rawText)
    const activeRun = this.client.prepare(`
      SELECT id FROM runs
      WHERE status IN ('created', 'running', 'paused')
      ORDER BY id
      LIMIT 1
    `).get() as { id: number } | undefined
    if (activeRun) throw new Error(`Đang có run #${activeRun.id} chưa kết thúc. Hãy dừng/hoàn tất run trước khi restore config.`)

    let accountsCreated = 0
    let pageTabsCreated = 0
    let pageTabsUpdated = 0
    let contentLibrariesRestored = 0
    let scenariosRestored = 0
    let importPresetsRestored = 0
    let columnLayoutRestored = false

    const restore = this.client.transaction(() => {
      const ensureAccount = (uidValue: string, name: string | null = null, category: string | null = null) => {
        const uid = uidValue.trim()
        if (!uid) throw new Error('Backup có account UID rỗng.')
        const existing = this.accounts.getByUid(uid)
        if (existing) return existing
        accountsCreated += 1
        return this.accounts.create({ uid, name, category, status: 'unknown' })
      }

      for (const rawAccount of payload.accounts) ensureAccount(rawAccount.uid, rawAccount.name, rawAccount.category)

      const restoredPostIds = new Map<string, number>()
      for (const post of payload.posts) {
        if (restoredPostIds.has(post.key)) throw new Error(`Portable post key bị trùng: ${post.key}.`)
        const created = this.canonicalPosts.create({ name: post.name, variants: post.variants, image: post.image })
        restoredPostIds.set(post.key, created.id)
      }
      const postId = (key: string): number => {
        const id = restoredPostIds.get(key)
        if (!id) throw new Error(`Không tìm thấy bài viết restore cho key “${key}”.`)
        return id
      }
      const backupPosts = new Map(payload.posts.map((post) => [post.key, post] as const))

      const legacySetIdByCollectionKey = new Map<string, number>()
      for (const collection of payload.postCollections) {
        const existingCollection = this.client.prepare(`
          SELECT id FROM post_collections WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1
        `).get(collection.name.trim()) as { id: number } | undefined
        const now = Date.now()
        let collectionId: number
        if (existingCollection) {
          collectionId = existingCollection.id
          this.client.prepare('UPDATE post_collections SET name = ?, updated_at = ? WHERE id = ?').run(collection.name.trim(), now, collectionId)
          this.client.prepare('DELETE FROM post_collection_bindings WHERE collection_id = ?').run(collectionId)
        } else {
          const result = this.client.prepare(`INSERT INTO post_collections (name, created_at, updated_at) VALUES (?, ?, ?)`).run(collection.name.trim(), now, now)
          collectionId = Number(result.lastInsertRowid)
        }
        const orderedBindings = collection.bindings.slice().sort((a, b) => a.sortOrder - b.sortOrder)
        const insertCollectionBinding = this.client.prepare(`
          INSERT INTO post_collection_bindings (collection_id, post_id, enabled, sort_order)
          VALUES (?, ?, ?, ?)
        `)
        orderedBindings.forEach((binding, index) => insertCollectionBinding.run(
          collectionId,
          postId(binding.postKey),
          binding.enabled ? 1 : 0,
          index
        ))

        const normalizedName = collection.name.trim()
        if (!normalizedName) throw new Error('Backup có nhóm bài viết tên rỗng.')
        const existingLegacy = this.client.prepare(`
          SELECT id FROM content_sets WHERE page_tab_id IS NULL AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1
        `).get(normalizedName) as { id: number } | undefined
        const legacyTarget = existingLegacy ? this.contentLibrary.get(existingLegacy.id) : this.contentLibrary.createSet({ name: normalizedName })
        if (!legacyTarget) throw new Error(`Không thể tạo compatibility source “${normalizedName}”.`)

        const previousLegacyItems = this.client.prepare(`
          SELECT id FROM content_items WHERE content_set_id = ? ORDER BY sort_order, id
        `).all(legacyTarget.id) as Array<{ id: number }>
        if (previousLegacyItems.length > 0) {
          const placeholders = previousLegacyItems.map(() => '?').join(', ')
          this.client.prepare(`
            DELETE FROM post_legacy_sources
            WHERE source_kind = 'content_item' AND source_id IN (${placeholders})
          `).run(...previousLegacyItems.map((item) => item.id))
        }
        this.client.prepare('DELETE FROM content_items WHERE content_set_id = ?').run(legacyTarget.id)

        for (const binding of orderedBindings) {
          const post = backupPosts.get(binding.postKey)
          if (!post) throw new Error(`Thiếu bài viết ${binding.postKey} cho nhóm “${collection.name}”.`)
          this.contentLibrary.createItem({
            contentSetId: legacyTarget.id,
            name: post.name,
            enabled: binding.enabled,
            variants: [...post.variants],
            image: legacyImage(post.image)
          })
        }

        const restoredLegacyItems = this.client.prepare(`
          SELECT id FROM content_items WHERE content_set_id = ? ORDER BY sort_order, id
        `).all(legacyTarget.id) as Array<{ id: number }>
        if (restoredLegacyItems.length !== orderedBindings.length) {
          throw new Error(`Không thể khôi phục provenance cho nhóm “${collection.name}”.`)
        }

        this.client.prepare(`
          DELETE FROM post_collection_legacy_sources
          WHERE content_set_id = ? OR collection_id = ?
        `).run(legacyTarget.id, collectionId)
        this.client.prepare(`
          INSERT INTO post_collection_legacy_sources (content_set_id, collection_id)
          VALUES (?, ?)
        `).run(legacyTarget.id, collectionId)

        const insertLegacySource = this.client.prepare(`
          INSERT OR IGNORE INTO post_legacy_sources (source_kind, source_id, post_id)
          VALUES ('content_item', ?, ?)
        `)
        orderedBindings.forEach((binding, index) => {
          const item = restoredLegacyItems[index]
          if (!item) throw new Error(`Thiếu compatibility item #${index + 1} cho nhóm “${collection.name}”.`)
          insertLegacySource.run(item.id, postId(binding.postKey))
        })

        legacySetIdByCollectionKey.set(collection.key, legacyTarget.id)
        contentLibrariesRestored += 1
      }

      const applyBindings = (
        repository: PageTabPostBindingRepository | ScenarioActionPostBindingRepository,
        contextId: number,
        bindings: readonly ConfigBackupPostBinding[]
      ) => {
        for (const binding of bindings.slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
          const id = postId(binding.postKey)
          repository.bindExisting(contextId, id)
          if (!binding.enabled) repository.setEnabled(contextId, id, false)
          const overrides = binding.overrides
          if (overrides.name !== null || overrides.variants !== null || overrides.imageFolderPath !== null
            || overrides.imageMode !== null || overrides.imagesPerPost !== null || overrides.missingPolicy !== null) {
            repository.updateOverrides(contextId, id, {
              name: overrides.name,
              variants: overrides.variants,
              imageFolderPath: overrides.imageFolderPath,
              imageMode: overrides.imageMode,
              imagesPerPost: overrides.imagesPerPost,
              missingPolicy: overrides.missingPolicy
            })
          }
        }
      }

      const knownTabs = this.pageTabs.list().map((item) => ({ id: item.id, name: item.name, pageUid: item.pageUid }))
      const usedTabIds = new Set<number>()
      for (const tab of payload.pageTabs) {
        const restoredAccounts = tab.accounts.map((account, index) => {
          const record = ensureAccount(account.uid)
          return { accountId: record.id, enabled: account.enabled, sortOrder: index, postsPerTurn: account.postsPerTurn }
        })
        const samePage = knownTabs.filter((item) => item.pageUid === tab.pageUid && !usedTabIds.has(item.id))
        const target = samePage.find((item) => item.name === tab.name) ?? (samePage.length === 1 ? samePage[0] : undefined)
        const created = target ? null : this.pageTabs.create({ name: tab.name, pageUid: tab.pageUid })
        const targetId = target?.id ?? created?.id
        if (!targetId) throw new Error(`Không thể xác định Page Tab đích cho “${tab.name}”.`)
        usedTabIds.add(targetId)
        if (target) pageTabsUpdated += 1
        else {
          pageTabsCreated += 1
          if (created) knownTabs.push({ id: created.id, name: created.name, pageUid: created.pageUid })
        }
        const updated = this.pageTabs.update(targetId, {
          name: tab.name,
          pageUid: tab.pageUid,
          rotation: { ...tab.rotation },
          accounts: restoredAccounts,
          schedules: tab.schedules.map((item, index) => ({ ...item, sortOrder: index })),
          groupUids: [...tab.groupUids],
          contentMode: tab.contentMode,
          contents: [...tab.contents],
          image: { ...tab.image }
        })
        this.client.prepare('DELETE FROM page_tab_post_bindings WHERE page_tab_id = ?').run(targetId)
        applyBindings(this.pageBindings, targetId, tab.postBindings)
        const effective = this.pageBindings.list(targetId)
        this.legacyPosts.save({
          pageTabId: targetId,
          mode: tab.postMode,
          posts: effective.map((binding, index) => ({
            postId: binding.postId,
            name: binding.name,
            enabled: binding.enabled,
            sortOrder: index,
            variants: [...binding.variants],
            image: { ...binding.image }
          }))
        })
        const knownIndex = knownTabs.findIndex((item) => item.id === updated.id)
        if (knownIndex >= 0) knownTabs[knownIndex] = { id: updated.id, name: updated.name, pageUid: updated.pageUid }
      }

      const knownScenarios = this.scenarios.list().map((item) => ({ id: item.id, name: item.name }))
      const usedScenarioIds = new Set<number>()
      for (const scenario of payload.scenarios) {
        const existing = knownScenarios.find((item) => item.name === scenario.name && !usedScenarioIds.has(item.id))
        let scenarioId: number
        if (existing) {
          scenarioId = existing.id
          usedScenarioIds.add(scenarioId)
          this.client.prepare('DELETE FROM scenario_actions WHERE scenario_id = ?').run(scenarioId)
          this.scenarios.update({
            id: scenarioId,
            patch: {
              name: scenario.name,
              randomActionOrder: scenario.randomActionOrder,
              runtimeLimitMinutes: scenario.runtimeLimitMinutes
            }
          })
        } else {
          const created = this.scenarios.create({
            name: scenario.name,
            randomActionOrder: scenario.randomActionOrder,
            runtimeLimitMinutes: scenario.runtimeLimitMinutes
          })
          scenarioId = created.id
          usedScenarioIds.add(scenarioId)
          knownScenarios.push({ id: created.id, name: created.name })
        }

        for (const action of scenario.actions) {
          const createdScenario = this.scenarios.createAction({
            scenarioId,
            actionType: action.actionType,
            label: action.label,
            category: action.category,
            enabled: action.enabled,
            configJson: action.configJson
          })
          const createdAction = createdScenario.actions[createdScenario.actions.length - 1]
          if (!createdAction) throw new Error(`Không thể tạo action “${action.label}” khi restore.`)
          applyBindings(this.scenarioBindings, createdAction.id, action.postBindings)

          if (action.actionType === 'post' && action.postBindings.length) {
            const actionPostKeys = action.postBindings.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((binding) => binding.postKey)
            const matchingCollection = payload.postCollections.find((collection) => {
              const collectionKeys = collection.bindings.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((binding) => binding.postKey)
              return collectionKeys.length === actionPostKeys.length && collectionKeys.every((key, index) => key === actionPostKeys[index])
            })
            let contentSetId = matchingCollection ? legacySetIdByCollectionKey.get(matchingCollection.key) : undefined
            if (!contentSetId) {
              const compatibilityName = `Kịch Bản · ${scenario.name} · ${action.label}`.slice(0, 120)
              const existingLegacy = this.client.prepare(`
                SELECT id FROM content_sets
                WHERE page_tab_id IS NULL AND name = ? COLLATE NOCASE
                ORDER BY id LIMIT 1
              `).get(compatibilityName) as { id: number } | undefined
              const legacy = existingLegacy ? this.contentLibrary.get(existingLegacy.id) : this.contentLibrary.createSet({ name: compatibilityName })
              if (!legacy) throw new Error(`Shông thヿ taạo compatibility source cho action “${action.label}”.`)
              this.client.prepare('DELETE FROM content_items WHERE content_set_id = ?').run(legacy.id)
              for (const binding of this.scenarioBindings.list(createdAction.id)) {
                this.contentLibrary.createItem({
                  contentSetId: legacy.id,
                  name: binding.name,
                  enabled: binding.enabled,
                  variants: [...binding.variants],
                  image: legacyImage(binding.image)
                })
              }
              contentSetId = legacy.id
            }
            const config = parseConfig(action.configJson)
            config.contentSetId = contentSetId
            this.scenarios.updateAction({ id: createdAction.id, patch: { configJson: JSON.stringify(config) } })
          } else if (action.actionType === 'group_post') {
            const bindings = this.scenarioBindings.list(createdAction.id)
            if (bindings.length === 1) {
              const binding = bindings[0]!
              const config = parseConfig(action.configJson)
              config.content = formatPostVariantText(binding.variants)
              config.imageFolderPath = binding.image.folderPath
              config.imageMode = binding.image.mode
              config.imagesPerPost = binding.image.imagesPerPost
              config.missingPolicy = binding.image.missingPolicy
              this.scenarios.updateAction({ id: createdAction.id, patch: { configJson: JSON.stringify(config) } })
            }
          }
        }
        scenariosRestored += 1
      }

      for (const preset of payload.importPresets) {
        this.accounts.saveImportPreset({ name: preset.name, delimiter: preset.delimiter, mapping: [...preset.mapping] })
        importPresetsRestored += 1
      }
      if (payload.accountColumnLayout) {
        this.accounts.saveColumnLayout('accounts', payload.accountColumnLayout)
        columnLayoutRestored = true
      }
    })

    restore()
    return {
      canceled: false,
      filePath,
      accountsCreated,
      pageTabsCreated,
      pageTabsUpdated,
      contentLibrariesRestored,
      canonicalPostsRestored: payload.posts.length,
      scenariosRestored,
      importPresetsRestored,
      columnLayoutRestored,
      message: `Đá restore ${pageTabsCreated + pageTabsUpdated} Page Tab, ${contentLibrariesRestored} nhóm bài viết, ${scenariosRestored} Kịch Bản và ${payload.posts.length} bài canonical; ${accountsCreated} account shell mới. Credential và browser profile không được import.`
    }
  }
}
