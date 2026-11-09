/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AUTH_CLIENT_ID: string;
	readonly VITE_SENTRY_DSN?: string;
	readonly VITE_BRIDGE_SENTRY_DSN?: string;
	readonly VITE_LAUNCHDARKLY_CLIENT_SIDE_ID?: string;
	readonly VITE_FEATURE_FLAG_OVERRIDES?: string;
	readonly VITE_POSTHOG_KEY?: string;
	readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
