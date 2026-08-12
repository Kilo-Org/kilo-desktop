import * as Sentry from "@sentry/electron/main";
import { app } from "electron";

import { createLogger } from "./logger.js";

const log = createLogger("sentry");

export function initSentry(): void {
	const isDev = !app.isPackaged;
	const dsn = import.meta.env.VITE_SENTRY_DSN;

	if (!dsn && !isDev) {
		log.debug("No DSN found, skipping initialization");
		return;
	}

	Sentry.init({
		dsn,
		environment: RELEASE_CHANNEL,
		tracesSampleRate: 0.1,
		...(isDev && {
			environment: "development",
			tracesSampleRate: 1.0,
			enableLogs: true,
			defaultIntegrations: false,
			integrations: [Sentry.spotlightIntegration({ sidecarUrl: "http://localhost:8969/stream" })],
		}),
	});

	log.debug("Sentry initialized", isDev ? "(dev: Spotlight only, no remote DSN)" : "");
}

export async function flushSentry(): Promise<void> {
	await Sentry.close(2000);
}
