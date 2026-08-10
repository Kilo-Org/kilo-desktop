/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AUTH_CLIENT_ID: string;
	readonly VITE_LAUNCHDARKLY_CLIENT_SIDE_ID?: string;
	readonly VITE_FEATURE_FLAG_OVERRIDES?: string;
	readonly VITE_ANACONDA_LOGGING_AUTH_URL?: string;
	readonly VITE_ANACONDA_LOGGING_NON_AUTH_URL?: string;
	readonly VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS?: string;
	readonly VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE?: string;
	readonly VITE_ANACONDA_LOGGING_APP_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
