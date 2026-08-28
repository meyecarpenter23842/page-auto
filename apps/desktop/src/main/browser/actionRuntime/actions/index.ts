import { applyK41ActionOverrides } from '../../../../shared/k41ActionOverrides'
import { applyK42FriendActionOverrides } from '../../../../shared/k42FriendActionOverrides'
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

export interface K4ActionDependencies {
  view: K41ViewActionDependencies
  friends: K42FriendActionDependencies
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

export function createK4ActionExecutorRegistry(dependencies: K4ActionDependencies): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK41ViewActionExecutors(registry, dependencies.view)
  registerK42FriendActionExecutors(registry, dependencies.friends)
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
