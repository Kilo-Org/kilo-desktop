import * as Sentry from "@sentry/electron/main";
import { app } from "electron";

import { createLogger } from "./logger.js";
import type { PreferencesStore } from "./PreferencesStore.js";

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
		environment: RELEASE_TRACK,
		tracesSampleRate: 0.1,
		// Route renderer→main events over the `ipcRenderer` bridge (wired by
		// `@sentry/electron/preload`, imported in the renderer preload) instead of
		// the default `sentry-ipc://` fetch protocol. The trusted app origin's
		// strict CSP has no `sentry-ipc:` in `connect-src` (and should not need
		// one), so the Protocol transport is refused and renderer telemetry is
		// silently dropped. Classic needs no CSP allowance and does not affect the
		// hash-based `script-src` (EoP 7).
		ipcMode: Sentry.IPCMode.Classic,
		...(isDev && {
			environment: "development",
			tracesSampleRate: 1.0,
			enableLogs: true,
			defaultIntegrations: false,
			integrations: [Sentry.spotlightIntegration()],
		}),
	});

	log.debug("Sentry initialized", isDev ? "(dev: Spotlight only, no remote DSN)" : "");
}

/**
 * Attaches the stable, anonymous installation id as the Sentry user so
 * issues report an affected-user count instead of only an event count.
 * This is not a real user identity - it's the same per-install UUID used
 * by the OTEL telemetry pipeline.
 */
export function identifySentryUser(preferences: PreferencesStore): void {
	Sentry.setUser({ id: preferences.getInstallationId() });
}

export async function flushSentry(): Promise<void> {
	await Sentry.close(2000);
}
