/// <reference types="vite/client" />

import type { PageAutoApi, PageWallFinitePreloadApi } from '../../preload'

declare global {
  interface Window {
    pageAuto: PageAutoApi
    pageWallFinite: PageWallFinitePreloadApi
  }
}

export {}
