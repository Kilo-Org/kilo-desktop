import * as Sentry from "@sentry/electron/main";
import { app } from "electron";

import { createLogger } from "./logger.js";
import type { PreferencesStore } from "./PreferencesStore.js";
import { scrubEnvelope, scrubSentryEvent } from "./sentry-scrub.js";

const log = createLogger("sentry");

/**
 * SDK v11 replaced `sendDefaultPii` with `dataCollection`, whose unset default
 * collects everything (user info/IP, cookies, bodies, …). Pin the v10
 * `sendDefaultPii: false` baseline from Sentry's migration guide.
 */
const HEADER_DENYLIST = ["forwarded", "-ip", "remote-", "via", "-user"];
const DATA_COLLECTION: NonNullable<Sentry.ElectronMainOptions["dataCollection"]> = {
	userInfo: false,
	cookies: false,
	httpHeaders: { request: { deny: HEADER_DENYLIST }, response: { deny: HEADER_DENYLIST } },
	httpBodies: [],
	urlQueryParams: { deny: HEADER_DENYLIST },
	genAI: { inputs: false, outputs: false },
	databaseQueryData: false,
	graphQL: { document: false, variables: false },
};

/**
 * Checks the preference when each envelope is actually sent. Gating the base
 * transport (inside the offline queue) covers errors, spans, sessions, native
 * crash dumps, and reports replayed from disk: while collection is off they are
 * dropped rather than stored for later.
 *
 * Spans, logs and metrics are scrubbed here rather than in `beforeSendSpan` /
 * `beforeSendLog` / `beforeSendMetric`, because renderers forward them straight
 * to the transport and they never reach main's hooks.
 */
function makeConsentGatedTransport(preferences: PreferencesStore) {
	return Sentry.makeElectronOfflineTransport((options) => {
		const transport = Sentry.makeElectronTransport(options);
		return {
			...transport,
			send: (envelope) =>
				preferences.allowDataCollection
					? transport.send(scrubEnvelope(envelope))
					: Promise.resolve({}),
		};
	});
}

export function initSentry(preferences: PreferencesStore): void {
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
		dataCollection: DATA_COLLECTION,
		// Redact user-identifying data (OS username in file paths, machine
		// hostname) from every error before it leaves the process. Renderer
		// errors are forwarded to this main client (IPCMode.Classic), so this
		// covers them too; spans are scrubbed by the transport. Data
		// minimization only — consent is enforced by the transport.
		beforeSend: (event) => scrubSentryEvent(event),
		transport: makeConsentGatedTransport(preferences),
		// Route renderer→main events over the `ipcRenderer` bridge (wired by
		// `@sentry/electron/preload`, imported in the renderer preload) instead of
		// the default `sentry-ipc://` fetch protocol. The trusted app origin's
		// strict CSP has no `sentry-ipc:` in `connect-src` (and should not need
		// one), so the Protocol transport is refused and renderer telemetry is
		// silently dropped. Classic needs no CSP allowance and does not affect the
		// hash-based `script-src`.
		ipcMode: Sentry.IPCMode.Classic,
		...(isDev && {
			environment: "development",
			tracesSampleRate: 1.0,
			defaultIntegrations: false,
			// Logs are on by default (no `enableLogs` in v11); send them with `Sentry.logger.*`.
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
