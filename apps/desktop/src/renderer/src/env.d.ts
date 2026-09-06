/// <reference types="vite/client" />

import type { AppUpdaterPreloadApi, ChangeInfoPreloadApi, PageAutoApi, PageScenarioSchedulePreloadApi, PageWallFinitePreloadApi } from '../../preload'

declare global {
  interface Window {
    pageAuto: PageAutoApi
    pageAutoUpdater: AppUpdaterPreloadApi
    pageScenarioSchedule: PageScenarioSchedulePreloadApi
    pageWallFinite: PageWallFinitePreloadApi
    pageAutoChangeInfo: ChangeInfoPreloadApi
  }
}

export {}
