/// <reference types="vite/client" />

import type { AppUpdaterPreloadApi, ChangeInfoPreloadApi, EmailBrowserLayoutPreloadApi, PageAutoApi, PageScenarioSchedulePreloadApi, PageWallFinitePreloadApi, ScannerPreloadApi, ZaloPreloadApi } from '../../preload'

declare global {
  interface Window {
    pageAuto: PageAutoApi
    pageAutoUpdater: AppUpdaterPreloadApi
    pageScenarioSchedule: PageScenarioSchedulePreloadApi
    pageWallFinite: PageWallFinitePreloadApi
    pageAutoChangeInfo: ChangeInfoPreloadApi
    pageAutoEmailBrowser: EmailBrowserLayoutPreloadApi
    pageAutoScanner: ScannerPreloadApi
    pageAutoZalo: ZaloPreloadApi
  }
}

export {}
