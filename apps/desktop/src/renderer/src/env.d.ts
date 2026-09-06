/// <reference types="vite/client" />

import type { AppUpdaterPreloadApi, PageAutoApi, PageScenarioSchedulePreloadApi, PageWallFinitePreloadApi } from '../../preload'

declare global {
  interface Window {
    pageAuto: PageAutoApi
    pageAutoUpdater: AppUpdaterPreloadApi
    pageScenarioSchedule: PageScenarioSchedulePreloadApi
    pageWallFinite: PageWallFinitePreloadApi
  }
}

export {}
