import type { Keyring } from "./keyring/keyring.js";

// Keyring

export interface RepoToken {
	token: string;
	org_name?: string | null | undefined;
}

export interface TokenPayload {
	domain: string;
	api_key?: string | null | undefined;
	username?: string | null | undefined;
	user_id?: string | null | undefined;
	repo_tokens?: RepoToken[] | null | undefined;
	version?: number | null | undefined;
}

export type KeyringFile = Record<string, Record<string, string>>;

export interface KeyringBackend {
	readonly name: string;
	readonly priority: number;
	/** Whether saveToken/deleteToken can persist; read-only backends report false. */
	readonly writable: boolean;
	getToken(domain: string): Promise<TokenPayload | null>;
	saveToken(domain: string, payload: TokenPayload): Promise<void>;
	deleteToken(domain: string): Promise<void>;
}

/** Minimal keyring surface `AnacondaCredentialStore` depends on, derived from `Keyring` itself. */
export type KeyringHandle = Pick<
	Keyring,
	"getToken" | "getApiKey" | "saveToken" | "deleteToken" | "writable"
>;
