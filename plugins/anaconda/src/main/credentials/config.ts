import { readFile, mkdir } from "node:fs/promises";
import { writeFile } from "atomically";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import { ConfigParseError, ConfigValidationError } from "./errors";

export const anacondaAuthSiteSchema = z.looseObject({
	preferred_token_storage: z.union([z.literal("system"), z.literal("anaconda-keyring")]).optional(),
	domain: z.string().optional(),
	auth_domain_override: z.string().nullish(),
	api_key: z.string().nullish(),
	keyring: z.record(z.string(), z.record(z.string(), z.string())).nullish(),
	keyring_path: z.string().optional(),
	ssl_verify: z.union([z.boolean(), z.string()]).optional(),
	client_id: z.string().optional(),
	redirect_uri: z.string().optional(),
	openid_config_path: z.string().optional(),
	login_success_path: z.string().optional(),
	login_error_path: z.string().optional(),
	use_unified_repo_api_key: z.boolean().optional(),
	hash_hostname: z.boolean().optional(),
	use_device_flow: z.boolean().optional(),
	client_cert: z.string().nullish(),
	client_cert_key: z.string().nullish(),
	proxy_servers: z.record(z.string(), z.string()).nullish(),
	extra_headers: z.union([z.record(z.string(), z.string()), z.string()]).nullish(),
});

export const anacondaConfigSchema = z.looseObject({
	default_site: z.string().optional(),
	plugin: z
		.looseObject({
			auth: anacondaAuthSiteSchema.optional(),
		})
		.optional(),
	sites: z.record(z.string(), anacondaAuthSiteSchema).optional(),
});

export type AnacondaAuthSite = z.infer<typeof anacondaAuthSiteSchema>;
export type AnacondaConfigData = z.infer<typeof anacondaConfigSchema>;

export interface AnacondaConfigOptions {
	defaults?: Partial<AnacondaConfigData>;
}

export class AnacondaConfig {
	#store: AnacondaConfigData;
	#path: string;
	#defaults: Partial<AnacondaConfigData>;

	private constructor(
		store: AnacondaConfigData,
		path: string,
		defaults: Partial<AnacondaConfigData>,
	) {
		this.#store = store;
		this.#path = path;
		this.#defaults = defaults;
	}

	static async load(options?: AnacondaConfigOptions): Promise<AnacondaConfig> {
		const path = process.env.ANACONDA_CONFIG_TOML || join(homedir(), ".anaconda", "config.toml");
		const raw = await AnacondaConfig.#readConfigFile(path);
		const store = AnacondaConfig.#parseConfigFile(raw, path);
		const defaults = options?.defaults ?? {};
		return new AnacondaConfig(store, path, defaults);
	}

	get store(): AnacondaConfigData {
		return this.#store;
	}

	get path(): string {
		return this.#path;
	}

	has(key: string): boolean {
		return key in this.#store;
	}

	get<K extends keyof AnacondaConfigData>(key: K): AnacondaConfigData[K] | undefined {
		return this.has(key) ? this.#store[key] : this.#defaults[key];
	}

	static async #readConfigFile(filePath: string): Promise<string> {
		try {
			return await readFile(filePath, "utf-8");
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
				await mkdir(dirname(filePath), { recursive: true });
				await writeFile(filePath, "", "utf-8");
				return "";
			}
			throw err;
		}
	}

	static #parseConfigFile(raw: string, filePath: string): AnacondaConfigData {
		if (raw.trim() === "") {
			return {} as AnacondaConfigData;
		}

		let parsed: unknown;
		try {
			parsed = parseToml(raw);
		} catch (cause) {
			throw new ConfigParseError(filePath, cause);
		}

		const result = anacondaConfigSchema.safeParse(parsed);
		if (!result.success) {
			throw new ConfigValidationError(filePath, result.error.issues);
		}

		return result.data;
	}
}
