import type { DeviceAuthState, IdentityState, KiloProfileData } from "../contracts";

/** The Kilo CLI's account API, reached through the running server. */
export interface KiloAccountClient {
	authStatus(): Promise<{ readonly authenticated: boolean }>;
	profile(): Promise<KiloProfileData>;
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
const IDLE: DeviceAuthState = { status: "idle" };

export const INITIAL_IDENTITY: IdentityState = {
	connection: "pending",
	authenticated: null,
	profile: null,
	profileError: null,
	deviceAuth: IDLE,
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

/** The user-enterable code in the CLI's device sign-in instructions. */
export function parseDeviceCode(instructions: string | undefined): string | undefined {
	return instructions?.match(/code:\s*(\S+)/i)?.[1];
}

export function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}

export interface IdentityServiceOptions {
	readonly client: () => KiloAccountClient | undefined;
	readonly onChange: (state: IdentityState) => void;
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
 * dropped the credentials (a 401), which is the same outcome.
 */
export class IdentityService {
	readonly #options: IdentityServiceOptions;
	#state: IdentityState = INITIAL_IDENTITY;
	#attempt = 0;
	#abort: AbortController | undefined;
	#signingIn: Promise<{ signedIn: boolean }> | undefined;

	constructor(options: IdentityServiceOptions) {
		this.#options = options;
	}

	get state(): IdentityState {
		return this.#state;
	}

	/** Follows the server: read the account once it is ready. */
	setConnection(connection: IdentityState["connection"]): void {
		if (connection === this.#state.connection) return;
		if (connection !== "connected") this.#abandonSignIn();
		this.#set({
			connection,
			...(connection === "connected" ? {} : { orgError: null }),
		});
		if (connection === "connected") void this.refresh();
	}

	async refresh(): Promise<void> {
		const client = this.#options.client();
		if (!client || this.#state.connection !== "connected") return;
		this.#set({ isRefreshing: true });
		try {
			await this.#read(client);
		} finally {
			this.#set({ isRefreshing: false });
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
		this.#set({ authenticated: false, profile: null, profileError: null, orgError: null });
		await this.#read(client);
	}

	async setOrganization(organizationId: string | null): Promise<void> {
		const client = this.#options.client();
		if (!client) return;
		this.#set({ isSwitchingOrg: true, orgError: null });
		try {
			await client.setOrganization(organizationId);
			await client.dispose().catch(() => undefined);
		} catch (error) {
			this.#set({
				orgError: {
					message: errorMessage(error, "Could not switch organization"),
					organizationId,
				},
			});
		} finally {
			await this.#read(client).catch(() => undefined);
			this.#set({ isSwitchingOrg: false });
		}
	}

	dismissOrgError(): void {
		this.#set({ orgError: null });
	}

	async #runSignIn(): Promise<{ signedIn: boolean }> {
		const client = this.#options.client();
		if (!client || this.#state.connection !== "connected") return { signedIn: false };
		const attempt = ++this.#attempt;
		const abort = new AbortController();
		this.#abort = abort;
		const current = () => attempt === this.#attempt;
		this.#set({ deviceAuth: { status: "initiating" } });
		try {
			const { url, instructions } = await client.authorize();
			if (!current()) return { signedIn: false };
			const code = parseDeviceCode(instructions);
			this.#set({
				deviceAuth: {
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
			this.#set({ deviceAuth: { status: "finishing" } });
			await client.dispose().catch(() => undefined);
			await this.#read(client);
			if (!current()) return { signedIn: false };
			this.#set({ deviceAuth: IDLE });
			if (this.#state.authenticated) this.#options.onSignedIn();
			return { signedIn: this.#state.authenticated === true };
		} catch (error) {
			if (current()) {
				this.#set({
					deviceAuth: { status: "error", error: errorMessage(error, "Sign-in failed") },
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
		if (this.#state.deviceAuth.status !== "idle") this.#set({ deviceAuth: IDLE });
	}

	async #read(client: KiloAccountClient): Promise<void> {
		let authenticated: boolean;
		try {
			authenticated = (await client.authStatus()).authenticated === true;
		} catch {
			this.#set({ authenticated: false, profile: null, profileError: null });
			return;
		}
		if (!authenticated) {
			this.#set({ authenticated: false, profile: null, profileError: null });
			return;
		}
		try {
			this.#set({ authenticated: true, profile: await client.profile(), profileError: null });
		} catch (error) {
			this.#set({
				authenticated: true,
				profile: null,
				profileError: errorMessage(error, "Could not load your Kilo account"),
			});
		}
	}

	#set(patch: Partial<IdentityState>): void {
		this.#state = { ...this.#state, ...patch };
		this.#options.onChange(this.#state);
	}
}
