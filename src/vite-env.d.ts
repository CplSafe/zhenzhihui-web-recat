/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZZH_REMOTE_ORIGIN: string
  readonly VITE_ZZH_ALLOWED_UPLOAD_ORIGINS: string
  readonly VITE_DEEPAUTH_REMOTE_ORIGIN: string
  readonly VITE_ZZH_API_BASE_URL: string
  readonly VITE_DEEPAUTH_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.png' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
