import * as Sentry from "@sentry/electron/main";

import { createLogger } from "./logger.js";

const log = createLogger("sentry");

export function initSentry(): void {
	const isDev = import.meta.env.DEV;
	const dsn = import.meta.env.VITE_SENTRY_DSN;

	if (!dsn && !isDev) {
		log.debug("No DSN found, skipping initialization");
		return;
	}

	Sentry.init({
		dsn,
		environment: isDev ? "development" : RELEASE_CHANNEL,
		tracesSampleRate: isDev ? 1.0 : 0.1,
		spotlight: isDev,
		enableLogs: isDev,
	});

	log.debug("Sentry initialized", isDev ? "(dev: Spotlight only, no remote DSN)" : "");
}

export async function flushSentry(): Promise<void> {
	await Sentry.close(2000);
}
