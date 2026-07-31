import type { AnacondaAuthSite } from "../config/config.js";
import type { KeyringBackend, KeyringFile, TokenPayload } from "../types.js";
import { KEYRING_NAME } from "../constants.js";
import { decodeToken } from "./codec.js";

export class ConfigKeyring implements KeyringBackend {
	readonly name = "config";
	readonly writable = false;
	#apiKey: string | undefined;
	#keyring: KeyringFile | undefined;
	#configDomain: string;

	constructor(site: AnacondaAuthSite) {
		this.#apiKey = site.api_key ?? undefined;
		this.#keyring = site.keyring ?? undefined;
		this.#configDomain = site.domain ?? "";
	}

	get priority(): number {
		return this.#apiKey || this.#keyring ? 100 : 0;
	}

	async getToken(domain: string): Promise<TokenPayload | null> {
		if (this.#apiKey && domain === this.#configDomain) {
			return { domain, api_key: this.#apiKey, repo_tokens: [] };
		}

		const encoded = this.#keyring?.[KEYRING_NAME]?.[domain];
		return encoded ? decodeToken(encoded) : null;
	}

	async saveToken(_domain: string, _payload: TokenPayload): Promise<void> {
		throw new Error(
			"Cannot save credentials: token storage is configured via environment or config file.",
		);
	}

	async deleteToken(_domain: string): Promise<void> {
		throw new Error(
			"Cannot delete credentials: token storage is configured via environment or config file.",
		);
	}
}
