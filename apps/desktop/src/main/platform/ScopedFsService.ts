import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { BusinessError } from "./BusinessError.js";

/** Same charset the plugin manifest enforces for plugin ids. */
const featureIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isFsError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

/**
 * Scoped filesystem backing `sdk.fs` — a capability boundary, not raw fs.
 *
 * Every operation is confined to the calling feature's private sandbox
 * directory (the Decision #20 storage root, `${userData}/plugins/<id>/`,
 * provided via `resolveSandboxRoot`). The service rejects invalid feature
 * ids, absolute paths, and any relative path that escapes the sandbox, so a
 * request can never reach another feature's files or the host filesystem.
 * Expected failures throw BusinessError so their messages survive the IPC
 * boundary; messages never include absolute host paths.
 */
export class ScopedFsService {
	constructor(private readonly resolveSandboxRoot: (featureId: string) => string) {}

	async #resolve(featureId: string, relativePath: string): Promise<string> {
		if (!featureIdPattern.test(featureId)) {
			throw new BusinessError("sdk.fs: invalid feature id.");
		}
		if (path.isAbsolute(relativePath)) {
			throw new BusinessError("sdk.fs paths must be relative to the feature's sandbox directory.");
		}
		const root = path.resolve(this.resolveSandboxRoot(featureId));
		const resolved = path.resolve(root, relativePath);
		if (resolved !== root && !resolved.startsWith(root + path.sep)) {
			throw new BusinessError("sdk.fs paths cannot escape the feature's sandbox directory.");
		}
		// Lazily create the sandbox root (mirrors mainSdk.storageDir) so reads
		// against a fresh sandbox behave sensibly (readdir("") → []).
		await mkdir(root, { recursive: true });
		return resolved;
	}

	async readFile(featureId: string, relativePath: string): Promise<string> {
		const target = await this.#resolve(featureId, relativePath);
		try {
			return await readFile(target, "utf8");
		} catch (error) {
			throw translateFsError(error, relativePath);
		}
	}

	async writeFile(featureId: string, relativePath: string, content: string): Promise<void> {
		const target = await this.#resolve(featureId, relativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}

	async exists(featureId: string, relativePath: string): Promise<boolean> {
		const target = await this.#resolve(featureId, relativePath);
		try {
			await stat(target);
			return true;
		} catch (error) {
			if (isFsError(error) && error.code === "ENOENT") return false;
			throw translateFsError(error, relativePath);
		}
	}

	async mkdir(featureId: string, relativePath: string): Promise<void> {
		const target = await this.#resolve(featureId, relativePath);
		await mkdir(target, { recursive: true });
	}

	async readdir(featureId: string, relativePath: string): Promise<string[]> {
		const target = await this.#resolve(featureId, relativePath);
		try {
			return await readdir(target);
		} catch (error) {
			throw translateFsError(error, relativePath);
		}
	}

	async remove(featureId: string, relativePath: string): Promise<void> {
		// force: removing a missing path is a no-op, matching `rm -rf`.
		const target = await this.#resolve(featureId, relativePath);
		await rm(target, { recursive: true, force: true });
	}
}

/**
 * Map expected Node fs failures to BusinessError (message survives IPC) using
 * the feature-relative path — never the absolute host path. Unexpected errors
 * pass through and get scrubbed to a generic INTERNAL message.
 */
function translateFsError(error: unknown, relativePath: string): unknown {
	if (!isFsError(error)) return error;
	switch (error.code) {
		case "ENOENT":
			return new BusinessError(`sdk.fs: no such file or directory: "${relativePath}".`);
		case "EISDIR":
			return new BusinessError(`sdk.fs: "${relativePath}" is a directory.`);
		case "ENOTDIR":
			return new BusinessError(`sdk.fs: "${relativePath}" is not a directory.`);
		default:
			return error;
	}
}
