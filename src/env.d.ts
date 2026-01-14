/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_KIS_PROXY_URL?: string
  readonly VITE_KIS_KOSPI_CODE?: string
  readonly VITE_KIS_KOSDAQ_CODE?: string
  readonly DATA_MODE?: string
  readonly VITE_DATA_MODE?: string
  [key: string]: string | undefined
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv
}
