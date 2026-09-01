export const INTERACTION_TARGET_MODES = [
  'friends',
  'friend_requests',
  'uid_distribute',
  'uid_limit',
  'uid_account_file',
  'groups',
  'seeding'
] as const

export type InteractionTargetMode = typeof INTERACTION_TARGET_MODES[number]
export type InteractionActor = 'profile' | 'page'
export type InteractionActionKey = 'reaction' | 'comment' | 'replyComment' | 'reactComment' | 'commentTag' | 'poke'
export type InteractionReactionKey = 'like' | 'love' | 'care' | 'haha' | 'wow' | 'sad' | 'angry'

export interface InteractionWorkspaceDraft {
  actor: InteractionActor
  pageUid: string
  targetMode: InteractionTargetMode
  targetValues: string
  uidFilePath: string
  actions: Record<InteractionActionKey, boolean>
  reactions: Record<InteractionReactionKey, boolean>
  commentMatch: string
  commentTemplates: string
  replyTemplates: string
  tagTargets: string
  targetLimit: number
  postsPerTarget: number
  delayMinSeconds: number
  delayMaxSeconds: number
  repeat: boolean
}

export const DEFAULT_INTERACTION_WORKSPACE_DRAFT: InteractionWorkspaceDraft = {
  actor: 'profile',
  pageUid: '',
  targetMode: 'friends',
  targetValues: '',
  uidFilePath: '',
  actions: {
    reaction: true,
    comment: false,
    replyComment: false,
    reactComment: false,
    commentTag: false,
    poke: false
  },
  reactions: {
    like: true,
    love: false,
    care: false,
    haha: false,
    wow: false,
    sad: false,
    angry: false
  },
  commentMatch: '',
  commentTemplates: '',
  replyTemplates: '',
  tagTargets: '',
  targetLimit: 20,
  postsPerTarget: 1,
  delayMinSeconds: 2,
  delayMaxSeconds: 5,
  repeat: false
}

const ACTION_KEYS: InteractionActionKey[] = ['reaction', 'comment', 'replyComment', 'reactComment', 'commentTag', 'poke']
const REACTION_KEYS: InteractionReactionKey[] = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry']
const TARGET_MODES = new Set<string>(INTERACTION_TARGET_MODES)

function cloneDefaultDraft(): InteractionWorkspaceDraft {
  return {
    ...DEFAULT_INTERACTION_WORKSPACE_DRAFT,
    actions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.actions },
    reactions: { ...DEFAULT_INTERACTION_WORKSPACE_DRAFT.reactions }
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function parseInteractionWorkspaceDraft(configJson: string): InteractionWorkspaceDraft {
  const fallback = cloneDefaultDraft()
  let parsed: unknown
  try {
    parsed = JSON.parse(configJson)
  } catch {
    return fallback
  }
  const raw = objectValue(parsed)
  if (!raw) return fallback

  const rawActions = objectValue(raw.actions)
  const rawReactions = objectValue(raw.reactions)
  const actions = { ...fallback.actions }
  const reactions = { ...fallback.reactions }
  for (const key of ACTION_KEYS) {
    if (typeof rawActions?.[key] === 'boolean') actions[key] = rawActions[key] as boolean
  }
  for (const key of REACTION_KEYS) {
    if (typeof rawReactions?.[key] === 'boolean') reactions[key] = rawReactions[key] as boolean
  }

  return {
    actor: raw.actor === 'page' ? 'page' : 'profile',
    pageUid: stringValue(raw.pageUid, fallback.pageUid),
    targetMode: typeof raw.targetMode === 'string' && TARGET_MODES.has(raw.targetMode)
      ? raw.targetMode as InteractionTargetMode
      : fallback.targetMode,
    targetValues: stringValue(raw.targetValues, fallback.targetValues),
    uidFilePath: stringValue(raw.uidFilePath, fallback.uidFilePath),
    actions,
    reactions,
    commentMatch: stringValue(raw.commentMatch, fallback.commentMatch),
    commentTemplates: stringValue(raw.commentTemplates, fallback.commentTemplates),
    replyTemplates: stringValue(raw.replyTemplates, fallback.replyTemplates),
    tagTargets: stringValue(raw.tagTargets, fallback.tagTargets),
    targetLimit: positiveNumber(raw.targetLimit, fallback.targetLimit),
    postsPerTarget: positiveNumber(raw.postsPerTarget, fallback.postsPerTarget),
    delayMinSeconds: nonNegativeNumber(raw.delayMinSeconds, fallback.delayMinSeconds),
    delayMaxSeconds: nonNegativeNumber(raw.delayMaxSeconds, fallback.delayMaxSeconds),
    repeat: typeof raw.repeat === 'boolean' ? raw.repeat : fallback.repeat
  }
}

export function serializeInteractionWorkspaceDraft(draft: InteractionWorkspaceDraft): string {
  return JSON.stringify(draft)
}

export function splitInteractionValues(value: string): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of value.split(/\r?\n|\|/g)) {
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}
