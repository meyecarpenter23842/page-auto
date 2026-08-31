import { applyK41ActionOverrides } from '../../../../shared/k41ActionOverrides'
import { applyK42FriendActionOverrides } from '../../../../shared/k42FriendActionOverrides'
import { applyK431JoinGroupActionOverrides } from '../../../../shared/k431JoinGroupActionOverrides'
import { applyK432InviteFriendsGroupActionOverrides } from '../../../../shared/k432InviteFriendsGroupActionOverrides'
import { applyK433GroupInteractionActionOverrides } from '../../../../shared/k433GroupInteractionActionOverrides'
import { applyK434LeaveGroupActionOverrides } from '../../../../shared/k434LeaveGroupActionOverrides'
import { applyK454StoryPostActionOverrides } from '../../../../shared/k454StoryPostActionOverrides'
import { ActionExecutorRegistry } from '../../../services/actionRunner'
import { ViewNewsfeedActionExecutor, type ViewNewsfeedDependencies } from './viewNewsfeedAction'
import { ViewStoryActionExecutor, type ViewStoryDependencies } from './viewStoryAction'
import { ViewReelActionExecutor, type ViewReelDependencies } from './viewReelAction'
import { FriendInteractionActionExecutor } from './friendInteractionAction'
import { PokeFriendActionExecutor } from './pokeFriendAction'
import { SendFriendRequestActionExecutor } from './sendFriendRequestAction'
import { AcceptFriendRequestActionExecutor } from './acceptFriendRequestAction'
import { CancelSentFriendRequestsActionExecutor } from './cancelSentFriendRequestsAction'
import { UnfriendActionExecutor } from './unfriendAction'
import { FriendFromEngagementActionExecutor } from './friendFromEngagementAction'
import type { FriendActionDependencies } from './friendActionSupport'
import { JoinGroupActionExecutor } from './joinGroupAction'
import type { JoinGroupActionDependencies } from './joinGroupActionSupport'
import { InviteFriendsToGroupActionExecutor } from './inviteFriendsToGroupAction'
import type { InviteFriendsToGroupActionDependencies } from './inviteFriendsToGroupActionSupport'
import { GroupInteractionActionExecutor } from './groupInteractionAction'
import type { GroupInteractionActionDependencies } from './groupInteractionActionSupport'
import { LeaveGroupActionExecutor, type LeaveGroupActionDependencies } from './leaveGroupAction'
import { StoryPostActionExecutor } from './storyPostAction'

export interface K41ViewActionDependencies {
  newsfeed: ViewNewsfeedDependencies
  story: ViewStoryDependencies
  reel: ViewReelDependencies
}

export interface K42FriendActionDependencies {
  friendInteraction: FriendActionDependencies
  pokeFriend: FriendActionDependencies
  sendFriendRequest: FriendActionDependencies
  acceptFriendRequest: FriendActionDependencies
  cancelSentFriendRequests: FriendActionDependencies
  unfriend: FriendActionDependencies
  friendFromEngagement: FriendActionDependencies
}

export interface K431JoinGroupActionDependencies {
  joinGroup: JoinGroupActionDependencies
}

export interface K432InviteFriendsGroupActionDependencies {
  inviteFriendsToGroup: InviteFriendsToGroupActionDependencies
}

export interface K433GroupInteractionActionDependencies {
  groupInteraction: GroupInteractionActionDependencies
}

export interface K434LeaveGroupActionDependencies {
  leaveGroup: LeaveGroupActionDependencies
}

export interface K43GroupActionDependencies extends K431JoinGroupActionDependencies {
  inviteFriendsToGroup?: InviteFriendsToGroupActionDependencies
  groupInteraction?: GroupInteractionActionDependencies
  leaveGroup?: LeaveGroupActionDependencies
}

export interface K4ActionDependencies {
  view: K41ViewActionDependencies
  friends: K42FriendActionDependencies
  groups: K43GroupActionDependencies
}

export function registerK41ViewActionExecutors(registry: ActionExecutorRegistry, dependencies: K41ViewActionDependencies): void {
  applyK41ActionOverrides()
  registry.register(new ViewNewsfeedActionExecutor(dependencies.newsfeed))
  registry.register(new ViewStoryActionExecutor(dependencies.story))
  registry.register(new ViewReelActionExecutor(dependencies.reel))
}

export function registerK42FriendActionExecutors(registry: ActionExecutorRegistry, dependencies: K42FriendActionDependencies): void {
  applyK42FriendActionOverrides()
  registry.register(new FriendInteractionActionExecutor(dependencies.friendInteraction))
  registry.register(new PokeFriendActionExecutor(dependencies.pokeFriend))
  registry.register(new SendFriendRequestActionExecutor(dependencies.sendFriendRequest))
  registry.register(new AcceptFriendRequestActionExecutor(dependencies.acceptFriendRequest))
  registry.register(new CancelSentFriendRequestsActionExecutor(dependencies.cancelSentFriendRequests))
  registry.register(new UnfriendActionExecutor(dependencies.unfriend))
  registry.register(new FriendFromEngagementActionExecutor(dependencies.friendFromEngagement))
}

export function registerK431JoinGroupActionExecutors(
  registry: ActionExecutorRegistry,
  dependencies: K431JoinGroupActionDependencies
): void {
  applyK431JoinGroupActionOverrides()
  registry.register(new JoinGroupActionExecutor(dependencies.joinGroup))
}

export function registerK432InviteFriendsGroupActionExecutors(
  registry: ActionExecutorRegistry,
  dependencies: K432InviteFriendsGroupActionDependencies
): void {
  applyK432InviteFriendsGroupActionOverrides()
  registry.register(new InviteFriendsToGroupActionExecutor(dependencies.inviteFriendsToGroup))
}

export function registerK433GroupInteractionActionExecutors(
  registry: ActionExecutorRegistry,
  dependencies: K433GroupInteractionActionDependencies
): void {
  applyK433GroupInteractionActionOverrides()
  registry.register(new GroupInteractionActionExecutor(dependencies.groupInteraction))
}

export function registerK434LeaveGroupActionExecutors(
  registry: ActionExecutorRegistry,
  dependencies: K434LeaveGroupActionDependencies
): void {
  applyK434LeaveGroupActionOverrides()
  registry.register(new LeaveGroupActionExecutor(dependencies.leaveGroup))
}

export function createK41ActionExecutorRegistry(dependencies: K41ViewActionDependencies): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK41ViewActionExecutors(registry, dependencies)
  return registry
}

export function createK42FriendActionExecutorRegistry(dependencies: K42FriendActionDependencies): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK42FriendActionExecutors(registry, dependencies)
  return registry
}

export function createK431JoinGroupActionExecutorRegistry(
  dependencies: K431JoinGroupActionDependencies
): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK431JoinGroupActionExecutors(registry, dependencies)
  return registry
}

export function createK432InviteFriendsGroupActionExecutorRegistry(
  dependencies: K432InviteFriendsGroupActionDependencies
): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK432InviteFriendsGroupActionExecutors(registry, dependencies)
  return registry
}

export function createK433GroupInteractionActionExecutorRegistry(
  dependencies: K433GroupInteractionActionDependencies
): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK433GroupInteractionActionExecutors(registry, dependencies)
  return registry
}

export function createK434LeaveGroupActionExecutorRegistry(
  dependencies: K434LeaveGroupActionDependencies
): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK434LeaveGroupActionExecutors(registry, dependencies)
  return registry
}

export function createK4ActionExecutorRegistry(dependencies: K4ActionDependencies): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK41ViewActionExecutors(registry, dependencies.view)
  registerK42FriendActionExecutors(registry, dependencies.friends)
  registerK431JoinGroupActionExecutors(registry, dependencies.groups)
  registerK432InviteFriendsGroupActionExecutors(registry, {
    inviteFriendsToGroup: dependencies.groups.inviteFriendsToGroup ?? dependencies.groups.joinGroup
  })
  registerK433GroupInteractionActionExecutors(registry, {
    groupInteraction: dependencies.groups.groupInteraction ?? dependencies.groups.joinGroup
  })
  registerK434LeaveGroupActionExecutors(registry, {
    leaveGroup: dependencies.groups.leaveGroup ?? dependencies.groups.groupInteraction ?? dependencies.groups.joinGroup
  })
  applyK454StoryPostActionOverrides()
  registry.register(new StoryPostActionExecutor(dependencies.view.story))
  return registry
}

export * from './viewNewsfeedAction'
export * from './viewStoryAction'
export * from './viewReelAction'
export * from './friendActionSupport'
export * from './friendInteractionAction'
export * from './pokeFriendAction'
export * from './sendFriendRequestAction'
export * from './acceptFriendRequestAction'
export * from './cancelSentFriendRequestsAction'
export * from './unfriendAction'
export * from './friendFromEngagementAction'
export * from './joinGroupActionSupport'
export * from './joinGroupAction'
export * from './inviteFriendsToGroupActionSupport'
export * from './inviteFriendsToGroupAction'
export * from './groupInteractionActionSupport'
export * from './groupInteractionAction'
export * from './leaveGroupAction'
export * from './storyPostAction'
