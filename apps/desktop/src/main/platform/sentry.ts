import * as Sentry from "@sentry/electron/main";

import { createLogger } from "./logger.js";

const log = createLogger("sentry");

export function initSentry(): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN;
	if (!dsn) return;

	Sentry.init({
		dsn,
		environment: import.meta.env.DEV ? "development" : (RELEASE_CHANNEL as string),
		tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
	});
	log.debug("Sentry initialized");
}

export async function flushSentry(): Promise<void> {
	await Sentry.close(2000);
}
