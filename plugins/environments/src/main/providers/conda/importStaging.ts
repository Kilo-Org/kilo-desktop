/**
 * Import staging — binds a conda environment import to the exact bytes the user
 * reviewed. One {@link ImportStagingRegistry} per provider registration owns the
 * feature-scoped `import-staging/` directory and is the only map from a handle
 * to a staged path; the renderer only ever sees the opaque handle.
 *
 * Staged copies are bounded by a TTL and an entry cap, pinned while an import is
 * in flight, and removed on release, sweep, or `dispose`. The registry sweeps
 * opportunistically on `stage`/`resolve`, so it holds no timers.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { KernelError } from "@kilo-desktop/kernel";

const STAGING_DIR_NAME = "import-staging";
/** conda selects its parser by extension, so a staged copy keeps a YAML suffix. */
const STAGED_FILE_NAME = "env.yml";
const DEFAULT_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_ENTRIES = 32;
const STAGED_NOT_FOUND_MESSAGE = "Staged file not found — re-select the file.";

/** Ceiling on how many bytes `conda.envs.readFile` reads and ships over IPC. */
export const READ_FILE_MAX_BYTES = 1024 * 1024;

/** O_NOFOLLOW is unavailable on Windows; there it degrades to a plain open. */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;

/**
 * Read a file with O_NOFOLLOW, so a symlink at the final path component fails
 * with ELOOP instead of being followed to new bytes. The byte cap is enforced on
 * the opened handle, so a file that grows after the caller's stat cannot be read
 * in full.
 */
export async function readFileNoFollow(filePath: string, maxBytes: number): Promise<Buffer> {
	const handle = await open(filePath, fsConstants.O_RDONLY | O_NOFOLLOW);
	try {
		const info = await handle.stat();
		if (info.size > maxBytes) throw fileTooLargeError(maxBytes);
		const buffer = Buffer.allocUnsafe(maxBytes + 1);
		let total = 0;
		while (total < buffer.length) {
			const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
			if (bytesRead === 0) break;
			total += bytesRead;
		}
		if (total > maxBytes) throw fileTooLargeError(maxBytes);
		return buffer.subarray(0, total);
	} finally {
		await handle.close();
	}
}

function fileTooLargeError(maxBytes: number): KernelError {
	return new KernelError(
		"VALIDATION",
		`File is too large to preview (max ${maxBytes / 1024 / 1024} MB).`,
	);
}

export interface ImportStagingEntry {
	readonly handle: string;
	readonly stagedPath: string;
	readonly digest: string;
	readonly createdAt: number;
}

export interface ImportStagingRegistryOptions {
	readonly rootDir: string;
	readonly ttlMs?: number;
	readonly maxEntries?: number;
	/** Injectable clock so tests can drive TTL/eviction without fake timers. */
	readonly now?: () => number;
}

export class ImportStagingRegistry {
	readonly #stagingDir: string;
	readonly #ttlMs: number;
	readonly #maxEntries: number;
	readonly #now: () => number;
	readonly #entries = new Map<string, ImportStagingEntry>();
	/** Handles resolved by an import that has not yet released them. */
	readonly #pinned = new Set<string>();

	constructor(options: ImportStagingRegistryOptions) {
		this.#stagingDir = join(options.rootDir, STAGING_DIR_NAME);
		this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.#now = options.now ?? (() => Date.now());
	}

	async stage(content: Buffer | string): Promise<ImportStagingEntry> {
		await this.sweep();
		await this.#evictOverflow();

		const handle = randomUUID();
		const dir = join(this.#stagingDir, handle);
		await mkdir(dir, { recursive: true, mode: 0o700 });
		const stagedPath = join(dir, STAGED_FILE_NAME);
		await writeFile(stagedPath, content, { mode: 0o600 });

		const entry: ImportStagingEntry = {
			handle,
			stagedPath,
			digest: sha256(content),
			createdAt: this.#now(),
		};
		this.#entries.set(handle, entry);
		return entry;
	}

	/** Throws `VALIDATION` for an unknown, expired, or tampered handle. */
	async resolve(handle: string): Promise<ImportStagingEntry> {
		await this.sweep();
		const entry = this.#entries.get(handle);
		if (!entry) throw new KernelError("VALIDATION", STAGED_NOT_FOUND_MESSAGE);
		// A handle binds exactly one import. Pin synchronously (no await between
		// the check and the add) so a concurrent second resolve is rejected
		// instead of racing the first release.
		if (this.#pinned.has(handle)) {
			throw new KernelError("VALIDATION", "This file is already being imported.");
		}
		this.#pinned.add(handle);
		try {
			await this.#verify(entry);
		} catch (error) {
			this.#pinned.delete(handle);
			throw error;
		}
		return entry;
	}

	async release(handle: string): Promise<void> {
		this.#pinned.delete(handle);
		this.#entries.delete(handle);
		await this.#removeDir(handle);
	}

	async sweep(): Promise<void> {
		const cutoff = this.#now() - this.#ttlMs;
		for (const [handle, entry] of [...this.#entries]) {
			if (this.#pinned.has(handle)) continue;
			if (entry.createdAt <= cutoff) {
				this.#entries.delete(handle);
				await this.#removeDir(handle);
			}
		}
		await this.#sweepOrphans(cutoff);
	}

	async dispose(): Promise<void> {
		this.#entries.clear();
		this.#pinned.clear();
		await rm(this.#stagingDir, { recursive: true, force: true }).catch(() => {});
	}

	async #evictOverflow(): Promise<void> {
		if (this.#entries.size < this.#maxEntries) return;
		// Insertion order: drop the oldest handles no in-flight import needs.
		for (const handle of [...this.#entries.keys()]) {
			if (this.#entries.size < this.#maxEntries) return;
			if (this.#pinned.has(handle)) continue;
			this.#entries.delete(handle);
			await this.#removeDir(handle);
		}
	}

	async #verify(entry: ImportStagingEntry): Promise<void> {
		let bytes: Buffer;
		try {
			bytes = await readFileNoFollow(entry.stagedPath, READ_FILE_MAX_BYTES);
		} catch {
			this.#entries.delete(entry.handle);
			await this.#removeDir(entry.handle);
			throw new KernelError("VALIDATION", STAGED_NOT_FOUND_MESSAGE);
		}
		if (sha256(bytes) !== entry.digest) {
			this.#entries.delete(entry.handle);
			await this.#removeDir(entry.handle);
			throw new KernelError(
				"VALIDATION",
				"Staged file failed an integrity check — re-select the file.",
			);
		}
	}

	async #removeDir(handle: string): Promise<void> {
		await rm(join(this.#stagingDir, handle), { recursive: true, force: true }).catch(() => {});
	}

	async #sweepOrphans(cutoff: number): Promise<void> {
		let names: string[];
		try {
			names = await readdir(this.#stagingDir);
		} catch {
			return;
		}
		for (const name of names) {
			if (this.#entries.has(name)) continue;
			const dir = join(this.#stagingDir, name);
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(dir);
			} catch {
				continue;
			}
			if (info.mtimeMs <= cutoff) {
				await rm(dir, { recursive: true, force: true }).catch(() => {});
			}
		}
	}
}

function sha256(content: Buffer | string): string {
	return createHash("sha256").update(content).digest("hex");
}
