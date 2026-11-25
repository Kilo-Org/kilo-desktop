import type { AccountState, DeviceSignInState, KiloProfile } from "../../contracts";

/** The Kilo server answered a request with 401. */
export class KiloUnauthorizedError extends Error {}

/** The Kilo CLI's account API, reached through the running server. */
export interface KiloAccountClient {
	/**
	 * Whether credentials are stored, and whether they are a device sign-in
	 * (OAuth); says nothing about whether Kilo still accepts them.
	 */
	authStatus(): Promise<{ readonly authenticated: boolean; readonly oauth?: boolean }>;
	/**
	 * Rejects with `KiloUnauthorizedError` when the server answers 401: for a
	 * sign-in, that Kilo refuses it (newer servers); for credentials that are
	 * not a sign-in, always.
	 */
	profile(): Promise<KiloProfile>;
	/** Whether Kilo's model catalog records that it refuses the stored credentials. */
	signInRefused(): Promise<boolean>;
	/** Starts device sign-in; the server opens the browser itself. */
	authorize(): Promise<{ readonly url: string; readonly instructions?: string | undefined }>;
	/** Resolves once the person approves in the browser. */
	callback(signal: AbortSignal): Promise<void>;
	signOut(): Promise<void>;
	setOrganization(organizationId: string | null): Promise<void>;
	/** Reloads the CLI's instance so it picks up new credentials. */
	dispose(): Promise<void>;
}

export const DEVICE_CODE_LIFETIME_SECONDS = 900;
const IDLE: DeviceSignInState = { status: "idle" };

export const INITIAL_ACCOUNT: AccountState = {
	connection: "pending",
	signedIn: null,
	profile: null,
	profileError: null,
	signInExpired: false,
	deviceSignIn: IDLE,
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

/** The user-enterable code in the CLI's device sign-in instructions. */
function parseDeviceCode(instructions: string | undefined): string | undefined {
	return instructions?.match(/code:\s*(\S+)/i)?.[1];
}

/**
 * The code the user confirms in the browser. The verification URL carries it
 * as its `code` parameter; the instructions text carries the poll secret, which
 * redeems the token rather than matching anything the browser shows, so it is
 * only a fallback for a server that sends a plain URL.
 */
export function deviceUserCode(attempt: {
	readonly url: string;
	readonly instructions?: string | undefined;
}): string | undefined {
	try {
		const code = new URL(attempt.url).searchParams.get("code");
		if (code) return code;
	} catch {
		// Not a URL; fall back to the instructions.
	}
	return parseDeviceCode(attempt.instructions);
}

export function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}

export interface AccountServiceOptions {
	readonly client: () => KiloAccountClient | undefined;
	readonly onChange: (state: AccountState) => void;
	readonly onSignedIn: () => void;
	readonly onSignedOut: () => void;
	readonly focusApp: () => void;
}

/**
 * The signed-in Kilo account, read from the CLI through the server. One
 * service in main so every window and plugin sees the same account and one
 * sign-in flow. Each flow gets an attempt number: cancelling, signing out or
 * losing the server bumps it, so a late approval from an abandoned flow never
 * lands. Signing out always ends signed out — the CLI may already have
 * dropped the credentials (a 401), which is the same outcome. A failed
 * organisation switch stays in `organizationError` until the next switch (or
 * until the server goes away).
 *
 * `authStatus` only says credentials are stored, so a failed profile read is
 * checked further (a 401 for a device sign-in, or older servers' catalog
 * failure): if Kilo refuses the credentials they are removed and the
 * account reads signed out with `signInExpired`, which the next successful
 * read clears. Any other failure stays a `profileError` the person can retry.
 * Mid-session the profile is not read again, so a chat request Kilo refuses
 * for the same reason (`signInRefused`) takes the same way out.
 */
export class AccountService {
	readonly #options: AccountServiceOptions;
	#state: AccountState = INITIAL_ACCOUNT;
	#attempt = 0;
	#abort: AbortController | undefined;
	#signingIn: Promise<{ signedIn: boolean }> | undefined;
	#expiring: Promise<void> | undefined;

	constructor(options: AccountServiceOptions) {
		this.#options = options;
	}

	get state(): AccountState {
		return this.#state;
	}

	/** Follows the server: read the account once it is ready. */
	setConnection(connection: AccountState["connection"]): void {
		if (connection === this.#state.connection) return;
		if (connection !== "connected") this.#abandonSignIn();
		this.#set({
			connection,
			...(connection === "connected" ? {} : { organizationError: null }),
		});
		if (connection === "connected") void this.refresh();
	}

	async refresh(): Promise<void> {
		const client = this.#options.client();
		if (!client || this.#state.connection !== "connected") return;
		this.#set({ refreshing: true });
		try {
			await this.#read(client);
		} finally {
			this.#set({ refreshing: false });
		}
	}

	/**
	 * A request Kilo made for this sign-in was refused because Kilo no longer
	 * accepts it. Several chats can report it at once; it is handled once.
	 */
	signInRefused(): Promise<void> {
		const client = this.#options.client();
		if (!client || this.#state.signedIn !== true || this.#signInInProgress()) {
			return Promise.resolve();
		}
		this.#expiring ??= this.#signOutRefused(client).finally(() => (this.#expiring = undefined));
		return this.#expiring;
	}

	signIn(): Promise<{ signedIn: boolean }> {
		this.#signingIn ??= this.#runSignIn().finally(() => (this.#signingIn = undefined));
		return this.#signingIn;
	}

	cancelSignIn(): void {
		this.#abandonSignIn();
	}

	async signOut(): Promise<void> {
		const client = this.#options.client();
		if (!client) return;
		this.#abandonSignIn();
		await client.signOut().catch(() => undefined);
		this.#options.onSignedOut();
		await client.dispose().catch(() => undefined);
		this.#set({ signedIn: false, profile: null, profileError: null, organizationError: null });
		await this.#read(client);
	}

	async setOrganization(organizationId: string | null): Promise<void> {
		const client = this.#options.client();
		if (!client) return;
		this.#set({ switchingOrganization: true, organizationError: null });
		try {
			await client.setOrganization(organizationId);
			await client.dispose().catch(() => undefined);
		} catch (error) {
			this.#set({
				organizationError: {
					message: errorMessage(error, "Could not switch organization"),
					organizationId,
				},
			});
		} finally {
			await this.#read(client).catch(() => undefined);
			this.#set({ switchingOrganization: false });
		}
	}

	async #runSignIn(): Promise<{ signedIn: boolean }> {
		const client = this.#options.client();
		if (!client || this.#state.connection !== "connected") return { signedIn: false };
		const attempt = ++this.#attempt;
		const abort = new AbortController();
		this.#abort = abort;
		const current = () => attempt === this.#attempt;
		this.#set({ deviceSignIn: { status: "initiating" } });
		try {
			const { url, instructions } = await client.authorize();
			if (!current()) return { signedIn: false };
			const code = deviceUserCode({ url, instructions });
			this.#set({
				deviceSignIn: {
					status: "waiting",
					...(code !== undefined ? { code } : {}),
					verificationUrl: url,
					expiresIn: DEVICE_CODE_LIFETIME_SECONDS,
				},
			});
			await client.callback(abort.signal);
			if (!current()) return { signedIn: false };
			// Approval happens in the browser; bring the person back to see it finish.
			this.#options.focusApp();
			this.#set({ deviceSignIn: { status: "finishing" } });
			await client.dispose().catch(() => undefined);
			await this.#read(client);
			if (!current()) return { signedIn: false };
			this.#set({ deviceSignIn: IDLE });
			if (this.#state.signedIn) this.#options.onSignedIn();
			return { signedIn: this.#state.signedIn === true };
		} catch (error) {
			if (current()) {
				this.#set({
					deviceSignIn: { status: "error", error: errorMessage(error, "Sign-in failed") },
				});
			}
			return { signedIn: false };
		} finally {
			if (this.#abort === abort) this.#abort = undefined;
		}
	}

	#abandonSignIn(): void {
		this.#attempt += 1;
		this.#abort?.abort();
		this.#abort = undefined;
		if (this.#state.deviceSignIn.status !== "idle") this.#set({ deviceSignIn: IDLE });
	}

	async #read(client: KiloAccountClient): Promise<void> {
		let status: Awaited<ReturnType<KiloAccountClient["authStatus"]>>;
		try {
			status = await client.authStatus();
		} catch {
			this.#set({ signedIn: false, profile: null, profileError: null });
			return;
		}
		if (status.authenticated !== true) {
			this.#set({ signedIn: false, profile: null, profileError: null });
			return;
		}
		try {
			const profile = await client.profile();
			this.#set({ signedIn: true, profile, profileError: null, signInExpired: false });
		} catch (error) {
			const refusedProfile = error instanceof KiloUnauthorizedError && status.oauth === true;
			if (await this.#refused(client, refusedProfile)) {
				await this.#signOutRefused(client);
				return;
			}
			this.#set({
				signedIn: true,
				profile: null,
				profileError: errorMessage(error, "Could not load your Kilo account"),
			});
		}
	}

	/**
	 * Whether a failed profile read means Kilo refuses the credentials, not a
	 * passing failure. Not while a device sign-in may be storing new ones: the
	 * refused credentials are about to be replaced, and removing them could
	 * remove the new ones. Servers that answer a refused sign-in's profile
	 * with 401 say so directly; older ones only through the model catalog.
	 */
	async #refused(client: KiloAccountClient, refusedProfile: boolean): Promise<boolean> {
		if (this.#signInInProgress()) return false;
		return refusedProfile || client.signInRefused().catch(() => false);
	}

	#signInInProgress(): boolean {
		const status = this.#state.deviceSignIn.status;
		return status === "initiating" || status === "waiting";
	}

	/**
	 * Refused credentials leave Kilo with no models at all, where none would
	 * still list the free ones, so they are removed rather than kept.
	 */
	async #signOutRefused(client: KiloAccountClient): Promise<void> {
		await client.signOut().catch(() => undefined);
		await client.dispose().catch(() => undefined);
		this.#set({ signedIn: false, profile: null, profileError: null, signInExpired: true });
	}

	#set(patch: Partial<AccountState>): void {
		this.#state = { ...this.#state, ...patch };
		this.#options.onChange(this.#state);
	}
}
