import type { SDK } from "@kilo-desktop/feature-sdk";

import {
	ANACONDA_ACCOUNT_CHANGED_EVENT,
	ANACONDA_ACCOUNT_FEATURE_ID,
	anacondaAccountSessionSchema,
	type AnacondaAccountCapability,
	type AnacondaAccountResult,
	type AnacondaAccountService,
	type AnacondaAccountSession,
} from "../contracts/schemas.js";

const ANONYMOUS: AnacondaAccountSession = { status: "anonymous" };

/**
 * Renderer-side Anaconda account store, exposed to other plugins as the
 * `account` capability. Keeps a synchronous session cache (so
 * `useSyncExternalStore` can read `peek()`), lazily resolves it from main on
 * the first subscriber, and follows main's `anaconda-account.changed` events
 * for transitions driven elsewhere (another window, the Account page vs. the
 * catalog). Sign-in/out never throw: failures come back as `{ ok: false }`.
 * A completed sign-in brings the main window back to the front, since the
 * flow ends on a browser page.
 * Telemetry is tracked here so every surface reports the same events —
 * `Anaconda Logged In`/`Anaconda Logged Out`, distinct from Kilo's sign-in.
 */
export function createAnacondaAccountCapability(
	sdk: Pick<SDK, "client" | "events" | "shell" | "telemetry">,
): AnacondaAccountCapability {
	const client = sdk.client as AnacondaAccountService;
	let session = ANONYMOUS;
	const subscribers = new Set<(session: AnacondaAccountSession) => void>();
	let stopEvents: (() => void) | undefined;

	const update = (next: AnacondaAccountSession): AnacondaAccountSession => {
		session = next;
		for (const fn of [...subscribers]) fn(next);
		return next;
	};

	const start = (): void => {
		stopEvents = sdk.events.on(
			`${ANACONDA_ACCOUNT_FEATURE_ID}.${ANACONDA_ACCOUNT_CHANGED_EVENT}`,
			(payload) => {
				const parsed = anacondaAccountSessionSchema.safeParse(payload);
				if (parsed.success) update(parsed.data);
			},
		);
		void client["session.get"]().then(update, () => {
			// No backend (browser mode) or IPC failure: keep the anonymous cache.
		});
	};

	// Set by `cancelSignIn` so the pending `signIn` reports a cancel, not a failure.
	let signInCancelled = false;

	const run = async (
		call: () => Promise<AnacondaAccountSession>,
		event: "Anaconda Logged In" | "Anaconda Logged Out",
		requireAuthenticated: boolean,
	): Promise<AnacondaAccountResult> => {
		try {
			const next = update(await call());
			if (requireAuthenticated && signInCancelled) {
				return { ok: false, reason: "Sign-in was cancelled.", cancelled: true };
			}
			if (next.status === "error") return { ok: false, reason: next.reason };
			if (requireAuthenticated && next.status !== "authenticated") {
				return { ok: false, reason: "Anaconda sign-in did not complete." };
			}
			void sdk.telemetry.track({ event, data: {} }).catch(() => undefined);
			if (requireAuthenticated) void sdk.shell.focusMainWindow().catch(() => undefined);
			return { ok: true };
		} catch (cause) {
			return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
		}
	};

	return {
		subscribe(fn) {
			subscribers.add(fn);
			fn(session);
			if (!stopEvents) start();
			return () => {
				subscribers.delete(fn);
				if (subscribers.size === 0) {
					stopEvents?.();
					stopEvents = undefined;
				}
			};
		},
		peek: () => session,
		getSession: async () => update(await client["session.get"]()),
		refresh: async () => update(await client["session.refresh"]()),
		signIn: () => {
			signInCancelled = false;
			return run(() => client.login(), "Anaconda Logged In", true);
		},
		cancelSignIn: async () => {
			signInCancelled = true;
			await client["login.cancel"]();
		},
		signOut: () => run(() => client.logout(), "Anaconda Logged Out", false),
	};
}
