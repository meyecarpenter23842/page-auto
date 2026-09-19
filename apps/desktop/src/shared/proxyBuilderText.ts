export const PROXY_BUILDER_TEXT_IPC = {
  copy: 'proxy-builder-text:copy',
  export: 'proxy-builder-text:export'
} as const

export interface ProxyBuilderTextPayload {
  text: string
}

export interface ProxyBuilderExportTextPayload extends ProxyBuilderTextPayload {
  suggestedName: string
}

export interface ProxyBuilderExportTextResult {
  cancelled: boolean
  filePath: string | null
}
