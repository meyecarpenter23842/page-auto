import type { PageAutoApi } from '../../preload'

declare global {
  interface Window {
    pageAuto: PageAutoApi
  }
}

export {}
