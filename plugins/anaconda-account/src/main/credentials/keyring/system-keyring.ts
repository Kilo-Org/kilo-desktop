import type { AnacondaAuthSite } from "../config.js";
import type { KeyringBackend, TokenPayload } from "../types.js";
import { KEYRING_NAME } from "../constants.js";
import { decodeToken, encodeToken } from "./codec.js";
import { SystemKeyringError } from "../errors.js";
import type * as KeytarModule from "@github/keytar";

/** The slice of `@github/keytar` the system backend uses. */
export type Keytar = Pick<typeof KeytarModule, "getPassword" | "setPassword" | "deletePassword">;
export type KeytarLoader = () => Promise<Keytar>;

const loadNativeKeytar: KeytarLoader = () =>
	import("@github/keytar").then((module) => module.default);

export class SystemKeyring implements KeyringBackend {
	readonly name = "system";
	readonly writable = true;
	#preferred: AnacondaAuthSite["preferred_token_storage"];
	#anacondaViable: boolean;
	readonly #loadKeytar: KeytarLoader;
	#keytarPromise?: Promise<Keytar>;

	constructor(site: AnacondaAuthSite, anacondaViable = true, loadKeytar = loadNativeKeytar) {
		this.#preferred = site.preferred_token_storage;
		this.#anacondaViable = anacondaViable;
		this.#loadKeytar = loadKeytar;
	}

	get priority(): number {
		if (this.#preferred === "system") {
			return 11;
		}
		return this.#anacondaViable ? 0 : 5;
	}

	#getKeytar(): Promise<Keytar> {
		this.#keytarPromise ??= this.#loadKeytar();
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
