/// <reference types="vite/client" />

import type { PageAutoApi, PageScenarioSchedulePreloadApi, PageWallFinitePreloadApi } from '../../preload'

declare global {
  interface Window {
    pageAuto: PageAutoApi
    pageScenarioSchedule: PageScenarioSchedulePreloadApi
    pageWallFinite: PageWallFinitePreloadApi
  }
}

export {}
