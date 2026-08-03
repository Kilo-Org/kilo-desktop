import type { AnacondaAuthSite } from "../config/config.js";
import type { KeyringBackend, TokenPayload } from "../types.js";
import { KEYRING_NAME } from "../constants.js";
import { decodeToken, encodeToken } from "./codec.js";
import { SystemKeyringError } from "../errors.js";
import type * as KeytarModule from "@github/keytar";

type Keytar = typeof KeytarModule;

export class SystemKeyring implements KeyringBackend {
	readonly name = "system";
	readonly writable = true;
	#preferred: AnacondaAuthSite["preferred_token_storage"];
	#anacondaViable: boolean;
	#keytarPromise?: Promise<Keytar>;

	constructor(site: AnacondaAuthSite, anacondaViable = true) {
		this.#preferred = site.preferred_token_storage;
		this.#anacondaViable = anacondaViable;
	}

	get priority(): number {
		if (this.#preferred === "system") {
			return 11;
		}
		return this.#anacondaViable ? 0 : 5;
	}

	#getKeytar(): Promise<Keytar> {
		this.#keytarPromise ??= import("@github/keytar").then((mod) => mod.default);
		return this.#keytarPromise;
	}

	async getToken(domain: string): Promise<TokenPayload | null> {
		let encoded: string | null;
		try {
			const keytar = await this.#getKeytar();
			encoded = await keytar.getPassword(KEYRING_NAME, domain);
		} catch (cause) {
			throw new SystemKeyringError(cause);
		}
		return encoded ? decodeToken(encoded) : null;
	}

	async saveToken(domain: string, payload: TokenPayload): Promise<void> {
		try {
			const keytar = await this.#getKeytar();
			await keytar.setPassword(KEYRING_NAME, domain, encodeToken(payload));
		} catch (cause) {
			throw new SystemKeyringError(cause);
		}
	}

	async deleteToken(domain: string): Promise<void> {
		try {
			const keytar = await this.#getKeytar();
			await keytar.deletePassword(KEYRING_NAME, domain);
		} catch (cause) {
			throw new SystemKeyringError(cause);
		}
	}
}
