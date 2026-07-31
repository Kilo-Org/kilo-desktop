import type { AnacondaAuthSite } from "../config/config.js";
import type { KeyringBackend, KeyringFile, TokenPayload } from "../types.js";
import { KEYRING_NAME, DEFAULT_KEYRING_PATH } from "../constants.js";
import { decodeToken, encodeToken } from "./codec.js";
import { AnacondaKeyringWriteError } from "../errors.js";
import { open, readFile, mkdir, unlink } from "node:fs/promises";
import { writeFile } from "atomically";
import isEmpty from "lodash/isEmpty.js";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (!/^~[\\/]/.test(path)) return path;
	return join(homedir(), ...path.slice(2).split(/[\\/]/));
}

export class AnacondaKeyring implements KeyringBackend {
	readonly name = "anaconda-keyring";
	readonly writable = true;
	#keyringPath: string;
	#preferred: AnacondaAuthSite["preferred_token_storage"];

	constructor(site: AnacondaAuthSite) {
		this.#keyringPath = expandHome(site.keyring_path ?? DEFAULT_KEYRING_PATH);
		this.#preferred = site.preferred_token_storage;
	}

	get path(): string {
		return this.#keyringPath;
	}

	get priority(): number {
		return this.#preferred === "system" ? 0.2 : 11;
	}

	/** Check whether the keyring file path is writable. */
	async isViable(): Promise<boolean> {
		try {
			await mkdir(dirname(this.#keyringPath), { recursive: true });
			const handle = await open(this.#keyringPath, "a");
			await handle.close();
			return true;
		} catch {
			return false;
		}
	}

	async getToken(domain: string): Promise<TokenPayload | null> {
		const file = await this.#readFile();
		const encoded = file[KEYRING_NAME]?.[domain];
		return encoded ? decodeToken(encoded) : null;
	}

	async saveToken(domain: string, payload: TokenPayload): Promise<void> {
		const file = await this.#readFile();
		const service = (file[KEYRING_NAME] ??= {});
		service[domain] = encodeToken(payload);
		await this.#writeFile(file);
	}

	async deleteToken(domain: string): Promise<void> {
		const file = await this.#readFile();
		const service = file[KEYRING_NAME];
		if (!service?.[domain]) return;

		delete service[domain];

		if (isEmpty(service)) {
			await unlink(this.#keyringPath);
			return;
		}

		await this.#writeFile(file);
	}

	async #readFile(): Promise<KeyringFile> {
		try {
			const content = await readFile(this.#keyringPath, "utf-8");
			return JSON.parse(content);
		} catch {
			return {};
		}
	}

	async #writeFile(file: KeyringFile): Promise<void> {
		try {
			await mkdir(dirname(this.#keyringPath), { recursive: true });
			await writeFile(this.#keyringPath, JSON.stringify(file));
		} catch (cause) {
			throw new AnacondaKeyringWriteError(this.#keyringPath, cause);
		}
	}
}
