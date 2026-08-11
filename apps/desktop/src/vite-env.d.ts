/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AUTH_CLIENT_ID: string;
	readonly VITE_LAUNCHDARKLY_CLIENT_SIDE_ID?: string;
	readonly VITE_FEATURE_FLAG_OVERRIDES?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
