import { applyK41ActionOverrides } from '../../../../shared/k41ActionOverrides'
import { ActionExecutorRegistry } from '../../../services/actionRunner'
import { ViewNewsfeedActionExecutor, type ViewNewsfeedDependencies } from './viewNewsfeedAction'
import { ViewStoryActionExecutor, type ViewStoryDependencies } from './viewStoryAction'
import { ViewReelActionExecutor, type ViewReelDependencies } from './viewReelAction'

export interface K41ViewActionDependencies {
  newsfeed: ViewNewsfeedDependencies
  story: ViewStoryDependencies
  reel: ViewReelDependencies
}

export function registerK41ViewActionExecutors(registry: ActionExecutorRegistry, dependencies: K41ViewActionDependencies): void {
  applyK41ActionOverrides()
  registry.register(new ViewNewsfeedActionExecutor(dependencies.newsfeed))
  registry.register(new ViewStoryActionExecutor(dependencies.story))
  registry.register(new ViewReelActionExecutor(dependencies.reel))
}

export function createK41ActionExecutorRegistry(dependencies: K41ViewActionDependencies): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry()
  registerK41ViewActionExecutors(registry, dependencies)
  return registry
}

export * from './viewNewsfeedAction'
export * from './viewStoryAction'
export * from './viewReelAction'
