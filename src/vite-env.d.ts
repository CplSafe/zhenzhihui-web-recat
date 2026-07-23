/// <reference types="vite/client" />

/** 项目自定义的 Vite 构建时环境变量类型。 */
interface ImportMetaEnv {
  readonly ZZH_DEV_PROXY_CONFIGURED: boolean
  readonly VITE_ZZH_ALLOWED_UPLOAD_ORIGINS: string
  readonly VITE_O2_CLIENT_TOKEN: string
  readonly VITE_O2_SITE: string
  readonly VITE_O2_ORG: string
  readonly VITE_O2_SERVICE: string
  readonly VITE_O2_ENV: string
  readonly VITE_O2_VERSION: string
  readonly VITE_O2_INSECURE: string
}

/** 扩展 import.meta.env，使业务代码读取环境变量时有类型提示。 */
interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 静态 PNG 资源导入后由 Vite 转换为 URL 字符串。 */
declare module '*.png' {
  const src: string
  export default src
}
/** 静态 SVG 资源导入后由 Vite 转换为 URL 字符串。 */
declare module '*.svg' {
  const src: string
  export default src
}
