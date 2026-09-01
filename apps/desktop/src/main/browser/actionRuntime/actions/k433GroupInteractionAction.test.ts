import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { createK4ActionExecutorRegistry, createK433GroupInteractionActionExecutorRegistry } from './index'
import {
  groupInteractionTargetsSatisfied,
  groupRestrictionBlocksOperation,
  type GroupInteractionStats,
  type GroupTargets
} from './groupInteractionAction'
import {
  classifyGroupRestriction,
  commentOnGroupArticle,
  configuredGroupWhitelist,
  directGroupUrlsFromWhitelist,
  groupArticles,
  groupIdentityAllowed,
  hasConfiguredGroupReaction,
  isAppliedReactionAriaLabel,
  reactToGroupArticle
} from './groupInteractionActionSupport'

describe('K4.3.3 group interaction executor', () => {
  it('registers group_interaction as its own executor', () => {
    const dependencies = { resolvePage: async () => null }
    const registry = createK433GroupInteractionActionExecutorRegistry({ groupInteraction: dependencies })
    expect(registry.has('group_interaction')).toBe(true)
    expect(registry.has('join_group')).toBe(false)
  })

  it('wires group interaction into the combined K4 registry with Common Runtime page dependency', () => {
    const common = { resolvePage: async () => null }
    const registry = createK4ActionExecutorRegistry({
      view: { newsfeed: common, story: common, reel: common },
      friends: {
        friendInteraction: common,
        pokeFriend: common,
        sendFriendRequest: common,
        acceptFriendRequest: common,
        cancelSentFriendRequests: common,
        unfriend: common,
        friendFromEngagement: common
      },
      groups: { joinGroup: common }
    })
    expect(registry.has('join_group')).toBe(true)
    expect(registry.has('invite_friends_to_group')).toBe(true)
    expect(registry.has('group_interaction')).toBe(true)
  })

  it('normalizes and applies a Group UID whitelist', () => {
    const whitelist = configuredGroupWhitelist({
      groupWhitelist: '123\nhttps://www.facebook.com/groups/TestSlug/\n123'
    })
    expect(whitelist).toEqual(['123', 'testslug'])
    expect(groupIdentityAllowed('123', whitelist)).toBe(true)
    expect(groupIdentityAllowed('other', whitelist)).toBe(false)
    expect(groupIdentityAllowed(null, [])).toBe(true)
  })

  it('turns an explicit Group whitelist into direct Group URLs before scraping joined-group links', () => {
    expect(directGroupUrlsFromWhitelist(['1527231867322980', 'testslug'], 2)).toEqual([
      'https://www.facebook.com/groups/1527231867322980/',
      'https://www.facebook.com/groups/testslug/'
    ])
    expect(directGroupUrlsFromWhitelist(['1', '2'], 1)).toEqual(['https://www.facebook.com/groups/1/'])
    expect(directGroupUrlsFromWhitelist([], 5)).toEqual([])
  })

  it('never treats the reaction enable flag itself as an implicit Like choice', () => {
    expect(hasConfiguredGroupReaction({
      reactionEnabled: true,
      reactionLike: false,
      reactionLove: false,
      reactionCare: false,
      reactionHaha: false,
      reactionWow: false,
      reactionSad: false,
      reactionAngry: false
    })).toBe(false)
    expect(hasConfiguredGroupReaction({ reactionEnabled: true, reactionLove: true })).toBe(true)
  })

  it('recognizes the live Facebook aria transition only after a reaction is applied', () => {
    expect(isAppliedReactionAriaLabel('Like')).toBe(false)
    expect(isAppliedReactionAriaLabel('Thích')).toBe(false)
    expect(isAppliedReactionAriaLabel('Remove Like')).toBe(true)
    expect(isAppliedReactionAriaLabel('Remove Love')).toBe(true)
    expect(isAppliedReactionAriaLabel('Bỏ Thích')).toBe(true)
    expect(isAppliedReactionAriaLabel(null)).toBe(false)
  })

  it('scopes Group posts from the live reaction rendering marker instead of relying only on role=article', () => {
    let selector = ''
    const locator = {} as Locator
    const page = {
      locator: (value: string) => {
        selector = value
        return locator
      }
    } as unknown as Page

    expect(groupArticles(page)).toBe(locator)
    expect(selector).toContain('data-ad-rendering-role="like_button"')
    expect(selector).toContain('count(parent::*')
    expect(selector).toContain('count(//*[@data-ad-rendering-role="like_button"])=1')
    expect(selector).toContain('@role="article"')
  })

  it('uses an unlabeled contenteditable as the post-local comment fallback', async () => {
    const candidate = {
      count: async () => 1,
      nth: () => candidate,
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined
    }
    const missing = {
      count: async () => 0,
      nth: () => missing
    }
    const article = {
      locator: (selector: string) => selector === '[contenteditable="true"]' ? candidate : missing
    } as unknown as Locator

    expect(await commentOnGroupArticle({} as Page, article, 'hello', '')).toBe(true)
  })

  it('verifies the post primary live reaction control instead of an applied reaction in a nested comment', async () => {
    let label = 'Like'
    let appliedScopeQueried = false

    const live = {
      first: () => live,
      count: async () => 1,
      nth: () => live,
      isVisible: async () => true,
      getAttribute: async (name: string) => name === 'aria-label' ? label : null,
      scrollIntoViewIfNeeded: async () => undefined,
      click: async () => {
        label = 'Remove Like'
      },
      dispatchEvent: async () => undefined
    }
    const missing = {
      first: () => missing,
      count: async () => 0,
      nth: () => missing,
      isVisible: async () => false
    }
    const article = {
      locator: (selector: string) => {
        if (selector.startsWith('xpath=self::*')) return missing
        if (selector === '[role="button"]:has([data-ad-rendering-role="like_button"])') return live
        if (selector.includes('aria-label^="Remove') || selector.includes('aria-label^="Unlike')
          || selector.includes('aria-label^="Bỏ') || selector.includes('aria-label^="Gỡ')
          || selector.includes('aria-label^="Xóa')) {
          appliedScopeQueried = true
        }
        return missing
      }
    } as unknown as Locator

    expect(await reactToGroupArticle({} as Page, article, { reactionEnabled: true, reactionLike: true })).toBe(true)
    expect(appliedScopeQueried).toBe(false)
  })

  it('classifies Facebook restriction messages without bypassing them', () => {
    expect(classifyGroupRestriction('You can\'t comment in this group right now.')).toBe('comment_blocked')
    expect(classifyGroupRestriction('Bạn không thể đăng trong nhóm này.')).toBe('posting_blocked')
    expect(classifyGroupRestriction('Your account is temporarily restricted.')).toBe('temporarily_restricted')
    expect(classifyGroupRestriction('Bài viết bình thường trong nhóm.')).toBeNull()
  })

  it('does not let a comment/post restriction suppress a valid reaction', () => {
    expect(groupRestrictionBlocksOperation('comment_blocked', 'reaction')).toBe(false)
    expect(groupRestrictionBlocksOperation('comment_blocked', 'comment')).toBe(true)
    expect(groupRestrictionBlocksOperation('posting_blocked', 'reaction')).toBe(false)
    expect(groupRestrictionBlocksOperation('posting_blocked', 'share_group')).toBe(true)
    expect(groupRestrictionBlocksOperation('temporarily_restricted', 'reaction')).toBe(true)
    expect(groupRestrictionBlocksOperation('temporarily_restricted', 'view')).toBe(true)
  })

  it('requires every configured interaction target before treating the action as complete', () => {
    const stats: GroupInteractionStats = {
      groupsVisited: 1,
      postsSeen: 1,
      viewed: 1,
      reacted: 1,
      commented: 0,
      commentsDeleted: 0,
      sharedToWall: 0,
      sharedToGroup: 0,
      restricted: 0,
      groupsLeft: 0,
      skipped: 0,
      failed: 0
    }
    const targets: GroupTargets = {
      views: 1,
      reactions: 1,
      comments: 0,
      wallShares: 1,
      groupShares: 0
    }

    expect(groupInteractionTargetsSatisfied(stats, targets)).toBe(false)
    expect(groupInteractionTargetsSatisfied({ ...stats, sharedToWall: 1 }, targets)).toBe(true)
  })
})
