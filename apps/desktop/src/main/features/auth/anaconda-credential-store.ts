import type { AnacondaOAuthSettings } from "@kilo-desktop/contracts";

import { createLogger, type Logger } from "../../platform/logger.js";
import {
	resolveSite,
	DEFAULT_DOMAIN,
	type ConfigLoader,
	type ResolvedSite,
} from "./config/site.js";
import { Keyring } from "./keyring/keyring.js";
import type { KeyringHandle } from "./types.js";

/** Module-level default logger; the constructor accepts an override for tests. */
const defaultLogger = createLogger("anaconda-credentials");

export type SiteResolver = (loader?: ConfigLoader) => Promise<ResolvedSite>;
export type KeyringLoader = (site: ResolvedSite) => Promise<KeyringHandle>;

export interface AnacondaCredentialStoreOptions {
	resolveSite?: SiteResolver;
	configLoader?: ConfigLoader;
	loadKeyring?: KeyringLoader;
	logger?: Pick<Logger, "warn">;
	/** Tag recorded on Anaconda API keys created by sign-in, e.g. `kilo-desktop/1.2.3`. */
	userAgent?: string;
}

/**
 * The Anaconda credential: the API key in the Anaconda keyring and the site
 * config it belongs to (`~/.anaconda/config.toml`, `.condarc`, env). Separate
 * from the app session, which is Kilo-backed (`AuthSessionService`).
 *
 * Reads degrade instead of throwing — `getApiKey` returns `null`,
 * `getSiteDomain` falls back to `anaconda.com` — because consumers (e.g. the
 * model catalog) only need a best-effort key. Writes and `getOAuthSettings`
 * reject instead, so a sign-in reports a broken config or read-only keyring
 * rather than silently targeting the wrong site. The keyring entry is shared
 * with the Anaconda CLI and conda. Main-process only: the key never crosses
 * to the renderer.
 */
export class AnacondaCredentialStore {
	readonly #resolveSite: SiteResolver;
	readonly #configLoader: ConfigLoader | undefined;
	readonly #loadKeyring: KeyringLoader;
	readonly #logger: Pick<Logger, "warn">;
	readonly #userAgent: string;

	constructor(options: AnacondaCredentialStoreOptions = {}) {
		this.#resolveSite = options.resolveSite ?? resolveSite;
		this.#configLoader = options.configLoader;
		this.#loadKeyring = options.loadKeyring ?? ((site) => Keyring.load(site));
		this.#logger = options.logger ?? defaultLogger;
		this.#userAgent = options.userAgent ?? "kilo-desktop";
	}

	/** The stored API key, or `null` when there is none or the keyring is unavailable. */
	async getApiKey(): Promise<string | null> {
		try {
			const keyring = await this.#loadKeyring(await this.#site());
			return await keyring.getApiKey();
		} catch {
			return null;
		}
	}

	/**
	 * Store an API key. The rest of an existing entry (e.g. `repo_tokens`) is
	 * kept; only the key and the identity fields describing the previous key
	 * (`username`, `user_id`) are replaced. Rejects when the keyring is
	 * read-only or unavailable.
	 */
	async saveApiKey(apiKey: string): Promise<void> {
		const keyring = await this.#writableKeyring();
		const existing = await keyring.getToken().catch(() => null);
		const { username: _username, user_id: _userId, ...kept } = existing ?? {};
		await keyring.saveToken({ ...kept, api_key: apiKey });
	}

	/**
	 * Remove the API key and the identity fields describing it (`username`,
	 * `user_id`), keeping the rest of the shared entry (e.g. `repo_tokens` for
	 * private channels). The entry is deleted only when nothing else is left.
	 * The Anaconda CLI and conda read the same key, so they lose it too.
	 * Rejects like {@link saveApiKey}.
	 */
	async deleteApiKey(): Promise<void> {
		const keyring = await this.#writableKeyring();
		const existing = await keyring.getToken().catch(() => null);
		if (existing?.repo_tokens?.length) {
			const { api_key: _apiKey, username: _username, user_id: _userId, ...kept } = existing;
			await keyring.saveToken({ ...kept, api_key: null });
		} else {
			await keyring.deleteToken();
		}
	}

	/**
	 * The site host (e.g. `stage.anaconda.com`, or `host:port` when
	 * self-hosted), falling back to `anaconda.com` when the config cannot be
	 * resolved.
	 */
	async getSiteDomain(): Promise<string> {
		try {
			return (await this.#site()).domain;
		} catch (cause) {
			this.#logger.warn(
				`getSiteDomain: site resolution failed, using default: ${errorReason(cause)}`,
			);
			return DEFAULT_DOMAIN;
		}
	}

	/**
	 * Settings for the OAuth sign-in. The client id comes from the site config,
	 * then the build-time `VITE_AUTH_CLIENT_ID` (empty when neither is set — the
	 * caller reports that). Rejects when the config cannot be resolved.
	 */
	async getOAuthSettings(): Promise<AnacondaOAuthSettings> {
		const site = await this.#site();
		const settings: AnacondaOAuthSettings = {
			domain: site.domain,
			clientId: site.client_id?.trim() || import.meta.env.VITE_AUTH_CLIENT_ID?.trim() || "",
			userAgent: this.#userAgent,
		};
		if (site.auth_domain_override) settings.issuerUrl = `https://${site.auth_domain_override}`;
		return settings;
	}

	#site(): Promise<ResolvedSite> {
		return this.#resolveSite(this.#configLoader);
	}

	async #writableKeyring(): Promise<KeyringHandle> {
		const keyring = await this.#loadKeyring(await this.#site());
		if (!keyring.writable) throw new Error("The Anaconda keyring is read-only.");
		return keyring;
	}
}

function errorReason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
