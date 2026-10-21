import isEqual from "lodash/isEqual.js";

import type { AuthSession } from "@kilo-desktop/contracts";

import type { AuthLogger } from "./types.js";
import { createLogger } from "../../platform/logger.js";

/** Module-level default logger; the constructor accepts an override for tests. */
const defaultLogger = createLogger("auth");

/** Kilo gateway `/kilo/profile` payload (fields the session identity needs). */
interface KiloProfile {
	profile?: {
		email?: string;
		name?: string;
		organizations?: Array<{ id: string; name: string; role: string }>;
		selectedOrganizationId?: string;
	};
	currentOrgId?: string | null;
}

/**
 * Main-side reader for the Kilo sidecar's auth state. Resolves the connection
 * lazily (the sidecar spawns on demand) and reads `auth-status`/`profile`
 * request/response — there is no push signal for Kilo auth (see the event
 * catalogue), so identity is always read fresh per resolution and any failure
 * degrades to anonymous rather than a stale signed-in identity.
 */
export interface KiloIdentityReader {
	getIdentity(): Promise<{ email?: string; org?: { id?: string; name?: string } } | null>;
	isAuthenticated(): Promise<boolean>;
	/**
	 * Whether the identity source can currently be reached. When false, an
	 * anonymous result is transient (boot race) and must not be cached — a later
	 * getSession() should re-resolve rather than serve a stale anonymous.
	 */
	available(): Promise<boolean>;
}

/** The kilo-server sidecar connection. */
export interface SidecarConnection {
	baseUrl: string;
	password: string;
}

/**
 * Builds the default Kilo identity reader over an injected connection resolver.
 * The resolver is injected (rather than read from the feature registry here)
 * so this module has no Electron/Sentry import chain and stays unit-testable.
 * Every read is fresh; failures throw so callers degrade to anonymous.
 */
export function createKiloIdentityReader(
	getConnection: () => Promise<SidecarConnection | null>,
	fetchImpl: (input: string, init?: { headers?: Record<string, string> }) => Promise<Response>,
): KiloIdentityReader {
	const fetchJson = async <T>(path: string): Promise<T | null> => {
		const connection = await getConnection();
		if (!connection) return null;
		const auth = Buffer.from(`kilo:${connection.password}`).toString("base64");
		const response = await fetchImpl(`${connection.baseUrl}${path}`, {
			headers: { Authorization: `Basic ${auth}` },
		});
		if (!response.ok) return null;
		return (await response.json()) as T;
	};
	return {
		async available() {
			return (await getConnection()) !== null;
		},
		async isAuthenticated() {
			const status = await fetchJson<{ authenticated?: boolean }>("/kilo/auth-status");
			return status?.authenticated === true;
		},
		async getIdentity() {
			const payload = await fetchJson<KiloProfile>("/kilo/profile");
			const profile = payload?.profile;
			if (!profile) return null;
			const result: { email?: string; org?: { id?: string; name?: string } } = {};
			if (profile.email) result.email = profile.email;
			// currentOrgId / selectedOrganizationId name the current org; map it to
			// the matching entry in organizations[] for id+name.
			const orgId = payload?.currentOrgId ?? profile.selectedOrganizationId;
			const org = orgId ? profile.organizations?.find((o) => o.id === orgId) : undefined;
			if (org) result.org = { id: org.id, name: org.name };
			return result;
		},
	};
}

export interface AuthSessionServiceOptions {
	kiloIdentity: KiloIdentityReader;
	logger?: AuthLogger;
}

const ANONYMOUS: AuthSession = { status: "anonymous" };

/**
 * The app session. Identity comes from the Kilo gateway (sidecar
 * `auth-status`/`profile`). The Anaconda API key is a separate credential,
 * owned by `AnacondaCredentialStore`. Passive only — login/logout are driven
 * by the renderer's Kilo gate and are not owned here. Resolution failures
 * degrade to `anonymous`/`error` and never throw to callers.
 */
export class AuthSessionService {
	#session: AuthSession = ANONYMOUS;
	#resolved = false;
	// True when the last anonymous resolution happened because the sidecar
	// connection wasn't up yet (boot race) — such a result must not be cached,
	// or telemetry/flags read anonymous forever after the sidecar comes up.
	#resolvedWithoutConnection = false;
	#inFlight: Promise<AuthSession> | undefined;
	readonly #listeners = new Set<(session: AuthSession) => void>();

	readonly #kiloIdentity: KiloIdentityReader;
	readonly #logger: AuthLogger;

	constructor(options: AuthSessionServiceOptions) {
		this.#kiloIdentity = options.kiloIdentity;
		this.#logger = options.logger ?? defaultLogger;
	}

	/** Current cached session without triggering resolution. */
	peek(): AuthSession {
		return this.#session;
	}

	/**
	 * Resolve lazily; subsequent calls return the cached value — except when the
	 * cached result is anonymous *and* the identity source wasn't reachable at
	 * resolution time (the sidecar spawns after features prepare). Such a
	 * boot-time anonymous is transient, so we re-resolve on the next call.
	 */
	async getSession(): Promise<AuthSession> {
		if (this.#resolved && !this.#resolvedWithoutConnection) return this.#session;
		if (this.#resolvedWithoutConnection && (await this.#kiloIdentity.available())) {
			// The source is up now — discard the transient boot result.
			this.#resolved = false;
			this.#resolvedWithoutConnection = false;
		}
		if (this.#resolved) return this.#session;
		return this.#resolve();
	}

	/** Force a re-resolution of the session. */
	async refresh(): Promise<AuthSession> {
		this.#resolved = false;
		return this.#resolve();
	}

	/**
	 * Login is not owned by main — the renderer's Kilo gate drives the device
	 * flow against the sidecar. This re-resolves the session so a caller that
	 * lands here (e.g. a stale sign-in prompt) reflects the current Kilo state.
	 */
	async login(): Promise<AuthSession> {
		return this.refresh();
	}

	/**
	 * Logout is not owned by main either (the Kilo gate signs out via the
	 * sidecar). Re-resolve so the published session drops to anonymous.
	 */
	async logout(): Promise<AuthSession> {
		return this.refresh();
	}

	/** Subscribe to session transitions. Returns an unsubscribe function. */
	onChanged(listener: (session: AuthSession) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** Stop fanning out to subscribers. Call on app/service teardown. */
	dispose(): void {
		this.#listeners.clear();
	}

	#resolve(): Promise<AuthSession> {
		this.#inFlight ??= this.#doResolve().finally(() => {
			this.#inFlight = undefined;
		});
		return this.#inFlight;
	}

	async #doResolve(): Promise<AuthSession> {
		const next = await this.#computeSession();
		this.#resolved = true;
		this.#commit(next);
		return next;
	}

	async #computeSession(): Promise<AuthSession> {
		let authenticated: boolean;
		try {
			authenticated = await this.#kiloIdentity.isAuthenticated();
		} catch (cause) {
			this.#logger.warn(`isAuthenticated read failed: ${errorReason(cause)}`);
			// A throw (sidecar metadata resolved but the socket isn't listening yet,
			// request timed out) is the same transient boot race as an explicit
			// "not available" — flag it so getSession() re-resolves once the
			// sidecar is up instead of caching this anonymous forever.
			this.#resolvedWithoutConnection = true;
			return ANONYMOUS;
		}
		if (!authenticated) {
			// Anonymous because the source was unreachable (boot race) is
			// transient — flag it so getSession() re-resolves once the sidecar
			// is up instead of serving a cached anonymous to telemetry/flags.
			this.#resolvedWithoutConnection = !(await this.#kiloIdentity.available().catch(() => false));
			return ANONYMOUS;
		}
		this.#resolvedWithoutConnection = false;

		try {
			const identity = await this.#kiloIdentity.getIdentity();
			const email = identity?.email;
			if (email === undefined || email === "") return ANONYMOUS;
			const user: { email: string; org?: { id?: string; name?: string } } = { email };
			if (identity?.org) user.org = identity.org;
			return { status: "authenticated", user };
		} catch (cause) {
			// A transient /kilo/profile failure after a successful isAuthenticated()
			// is the same transient class as the boot race — flag it so getSession()
			// re-resolves once the sidecar recovers instead of pinning the session
			// at "error" for the process lifetime.
			this.#resolvedWithoutConnection = true;
			return { status: "error", reason: errorReason(cause) };
		}
	}

	#commit(next: AuthSession): void {
		if (isEqual(this.#session, next)) return;
		this.#session = next;
		for (const listener of this.#listeners) listener(next);
	}
}

function errorReason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
