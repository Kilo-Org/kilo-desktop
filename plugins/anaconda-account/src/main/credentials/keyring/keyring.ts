import type { AnacondaAuthSite } from "../config.js";
import type { KeyringBackend, TokenPayload } from "../types.js";
import { TOKEN_INFO_VERSION } from "../constants.js";
import { AnacondaKeyring } from "./anaconda-keyring.js";
import { ConfigKeyring } from "./config-keyring.js";
import { SystemKeyring, type KeytarLoader } from "./system-keyring.js";
import { SystemKeyringError } from "../errors.js";

/**
 * The Anaconda keyring, as the Anaconda CLI and conda read it: a token entry per
 * site domain in the highest-priority backend that has one. A key set in
 * `config.toml` (or the environment) wins and is read-only; otherwise the
 * `~/.anaconda/keyring` file and the system keychain (service `Anaconda
 * Cloud`) are tried in priority order, and writes go to the primary backend.
 */
export class Keyring {
	#domain: string;
	#backends: KeyringBackend[];
	#primary: KeyringBackend;

	get domain(): string {
		return this.#domain;
	}

	get writable(): boolean {
		return this.#primary.writable;
	}

	/**
	 * Factory to create a Keyring, resolving backend viability
	 * and determining the primary write target.
	 */
	static async load(site: AnacondaAuthSite, loadKeytar?: KeytarLoader): Promise<Keyring> {
		// Packaged e2e sets this so the app does not inherit the host Anaconda
		// keychain / ~/.anaconda keyring (those live outside --user-data-dir).
		if (process.env.ANACONDA_SKIP_KEYRING === "1") {
			const isolated = new ConfigKeyring({ ...site, api_key: null, keyring: {} });
			return new Keyring(site.domain ?? "", [isolated], isolated);
		}

		const configBackend = new ConfigKeyring(site);

		if (configBackend.priority > 0) {
			return new Keyring(site.domain ?? "", [configBackend], configBackend);
		}

		const anacondaBackend = new AnacondaKeyring(site);
		const anacondaViable = await anacondaBackend.isViable();

		const backends = [
			new SystemKeyring(site, anacondaViable, loadKeytar),
			...(anacondaViable ? [anacondaBackend] : []),
		]
			.filter((b) => b.priority > 0)
			.sort((a, b) => b.priority - a.priority);

		const primary = backends[0];
		if (!primary) {
			throw new Error("No keyring backends available with priority > 0");
		}

		return new Keyring(site.domain ?? "", backends, primary);
	}

	private constructor(domain: string, backends: KeyringBackend[], primary: KeyringBackend) {
		this.#domain = domain;
		this.#backends = backends;
		this.#primary = primary;
	}

	async getToken(): Promise<TokenPayload | null> {
		for (const backend of this.#backends) {
			try {
				const entry = await backend.getToken(this.#domain);
				if (entry) return entry;
			} catch (cause) {
				if (cause instanceof SystemKeyringError) continue;
				throw cause;
			}
		}
		return null;
	}

	async getApiKey(): Promise<string | null> {
		const entry = await this.getToken();
		return entry?.api_key ?? null;
	}

	async getUserId(): Promise<string | null> {
		const entry = await this.getToken();
		return entry?.user_id ?? null;
	}

	async saveToken(token: Partial<TokenPayload>): Promise<void> {
		const payload: TokenPayload = {
			domain: this.#domain,
			version: TOKEN_INFO_VERSION,
			repo_tokens: [],
			...token,
		};
		await this.#primary.saveToken(this.#domain, payload);
	}

	async deleteToken(): Promise<void> {
		await this.#primary.deleteToken(this.#domain);
	}
}
