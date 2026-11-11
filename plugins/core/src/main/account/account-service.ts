import type { AccountState, DeviceSignInState, KiloProfile } from "../../contracts";

/** The Kilo CLI's account API, reached through the running server. */
export interface KiloAccountClient {
	authStatus(): Promise<{ readonly authenticated: boolean }>;
	profile(): Promise<KiloProfile>;
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
	deviceSignIn: IDLE,
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

/** The user-enterable code in the CLI's device sign-in instructions. */
export function parseDeviceCode(instructions: string | undefined): string | undefined {
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
 */
export class AccountService {
	readonly #options: AccountServiceOptions;
	#state: AccountState = INITIAL_ACCOUNT;
	#attempt = 0;
	#abort: AbortController | undefined;
	#signingIn: Promise<{ signedIn: boolean }> | undefined;

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
		let signedIn: boolean;
		try {
			signedIn = (await client.authStatus()).authenticated === true;
		} catch {
			this.#set({ signedIn: false, profile: null, profileError: null });
			return;
		}
		if (!signedIn) {
			this.#set({ signedIn: false, profile: null, profileError: null });
			return;
		}
		try {
			this.#set({ signedIn: true, profile: await client.profile(), profileError: null });
		} catch (error) {
			this.#set({
				signedIn: true,
				profile: null,
				profileError: errorMessage(error, "Could not load your Kilo account"),
			});
		}
	}

	#set(patch: Partial<AccountState>): void {
		this.#state = { ...this.#state, ...patch };
		this.#options.onChange(this.#state);
	}
}
