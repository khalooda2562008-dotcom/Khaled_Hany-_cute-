/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_STORAGE_ENABLED?: string;
  readonly VITE_CLOUD_API_BASE?: string;
  readonly VITE_BASE_PATH?: string;
  readonly PROD: boolean;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
