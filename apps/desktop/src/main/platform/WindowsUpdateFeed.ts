import { createHash, type Hash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import escapeRegExp from "lodash/escapeRegExp.js";
import { gt, rcompare, valid } from "semver";

const RELEASES_FILE_NAME = "RELEASES";
const PARTIAL_SUFFIX = ".partial";
const MAX_RELEASES_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024 * 1024;
const RELEASES_TIMEOUT_MS = 15_000;
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;
const RELEASE_LINE = /^([0-9a-f]{40})\s+(\S+)\s+(\d+)$/i;

export interface FullRelease {
	readonly sha1: string;
	readonly fileName: string;
	readonly size: number;
	readonly version: string;
}

export type PreparedWindowsFeed =
	| { readonly kind: "up-to-date" }
	| { readonly kind: "ready"; readonly version: string };

export interface PrepareWindowsFeedInput {
	readonly remoteFeedUrl: string;
	readonly currentVersion: string;
	readonly signal: AbortSignal;
	readonly onDownloadStart: (version: string) => void;
}

interface WindowsUpdateFeedOptions {
	readonly directory: string;
	/** Squirrel package id (`KiloDesktop`); RELEASES entries for other ids are ignored. */
	readonly packageName: string;
	readonly fetch: typeof globalThis.fetch;
}

/** Update-server or package-integrity failure, with the HTTP status when one applies. */
export class UpdateFeedError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "UpdateFeedError";
		this.status = status;
	}
}

/**
 * Mirrors the newest Squirrel.Windows full package into a local directory so
 * `Update.exe` installs from disk instead of downloading over HTTP itself.
 * Squirrel's bundled .NET `WebClient` sends no User-Agent and bypasses the
 * app's proxy handling, and CDN bot rules reject it; fetching through
 * Electron's `net` stack avoids both. Squirrel natively accepts a directory as
 * its update target (it reads `<dir>/RELEASES` and copies the `.nupkg`), so the
 * install path itself is unchanged.
 *
 * Invariants: the directory holds at most one package, plus a RELEASES file
 * listing exactly that package, and only after its size and SHA1 match the
 * remote RELEASES entry. Package names are matched against a strict pattern so
 * a tampered RELEASES cannot write outside the directory. A `.partial` file is
 * resumed with an HTTP Range request when the server honours it. Everything in
 * the directory is disposable: anything not belonging to the current target is
 * deleted on every prepare.
 */
export class WindowsUpdateFeed {
	readonly #options: WindowsUpdateFeedOptions;

	constructor(options: WindowsUpdateFeedOptions) {
		this.#options = options;
	}

	get directory(): string {
		return this.#options.directory;
	}

	async prepare(input: PrepareWindowsFeedInput): Promise<PreparedWindowsFeed> {
		const release = await this.#fetchNewestRelease(input.remoteFeedUrl, input.signal);
		if (!gt(release.version, input.currentVersion)) {
			await this.clear();
			return { kind: "up-to-date" };
		}

		await mkdir(this.directory, { recursive: true });
		await this.#removeEntriesExcept(release.fileName, `${release.fileName}${PARTIAL_SUFFIX}`);
		const packagePath = path.join(this.directory, release.fileName);
		if (!(await fileMatches(packagePath, release))) {
			input.onDownloadStart(release.version);
			await this.#downloadPackage(
				`${input.remoteFeedUrl}/${encodeURIComponent(release.fileName)}`,
				release,
				input.signal,
			);
		}
		await writeFile(
			path.join(this.directory, RELEASES_FILE_NAME),
			`${release.sha1} ${release.fileName} ${release.size}`,
		);
		return { kind: "ready", version: release.version };
	}

	async clear(): Promise<void> {
		await rm(this.directory, { recursive: true, force: true });
	}

	async #fetchNewestRelease(remoteFeedUrl: string, signal: AbortSignal): Promise<FullRelease> {
		const response = await this.#get(
			`${remoteFeedUrl}/${RELEASES_FILE_NAME}`,
			AbortSignal.any([signal, AbortSignal.timeout(RELEASES_TIMEOUT_MS)]),
		);
		const body = await response.text();
		if (Buffer.byteLength(body, "utf8") > MAX_RELEASES_BYTES) {
			throw new UpdateFeedError("The update RELEASES file exceeded the size limit.");
		}
		const release = parseNewestFullRelease(body, this.#options.packageName);
		if (!release) throw new UpdateFeedError("The update RELEASES file lists no full package.");
		return release;
	}

	async #downloadPackage(url: string, release: FullRelease, signal: AbortSignal): Promise<void> {
		const partialPath = path.join(this.directory, `${release.fileName}${PARTIAL_SUFFIX}`);
		let offset = await fileSize(partialPath);
		if (offset >= release.size) {
			await rm(partialPath, { force: true });
			offset = 0;
		}

		const stall = new AbortController();
		let stallTimer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_TIMEOUT_MS);
		const resetStallTimer = () => {
			clearTimeout(stallTimer);
			stallTimer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_TIMEOUT_MS);
		};
		const downloadSignal = AbortSignal.any([signal, stall.signal]);

		try {
			const response = await this.#get(
				url,
				downloadSignal,
				offset > 0 ? { Range: `bytes=${offset}-` } : {},
			);
			if (response.status !== 206) offset = 0;
			if (!response.body) throw new UpdateFeedError("The update package response was empty.");

			const hash = createHash("sha1");
			if (offset > 0) await hashFileInto(hash, partialPath);
			let received = offset;
			const verify = new Transform({
				transform(chunk: Buffer, _encoding, callback) {
					resetStallTimer();
					received += chunk.length;
					if (received > release.size) {
						callback(new UpdateFeedError("The update package is larger than RELEASES declares."));
						return;
					}
					hash.update(chunk);
					callback(null, chunk);
				},
			});
			await pipeline(
				Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
				verify,
				createWriteStream(partialPath, { flags: offset > 0 ? "a" : "w" }),
				{ signal: downloadSignal },
			);

			if (received !== release.size || hash.digest("hex") !== release.sha1.toLowerCase()) {
				await rm(partialPath, { force: true });
				throw new UpdateFeedError("The downloaded update package failed verification.");
			}
			await rename(partialPath, path.join(this.directory, release.fileName));
		} catch (error) {
			if (error instanceof UpdateFeedError && error.status === 416) {
				await rm(partialPath, { force: true });
			}
			if (stall.signal.aborted && !signal.aborted) {
				throw new UpdateFeedError("The update download stalled.");
			}
			throw error;
		} finally {
			clearTimeout(stallTimer);
		}
	}

	async #get(
		url: string,
		signal: AbortSignal,
		headers: Record<string, string> = {},
	): Promise<Response> {
		const response = await this.#options.fetch(url, {
			headers: { "Cache-Control": "no-cache", ...headers },
			signal,
		});
		if (!response.ok) {
			throw new UpdateFeedError(
				`The update server returned HTTP ${response.status}.`,
				response.status,
			);
		}
		return response;
	}

	async #removeEntriesExcept(...keep: string[]): Promise<void> {
		const entries = await readdir(this.directory).catch(() => []);
		await Promise.all(
			entries
				.filter((entry) => !keep.includes(entry))
				.map((entry) => rm(path.join(this.directory, entry), { recursive: true, force: true })),
		);
	}
}

/**
 * Returns the highest-versioned full package for `packageName` listed in a
 * Squirrel RELEASES file. Delta packages, other package ids, and file names
 * that are not a bare `<id>-<semver>-full.nupkg` are ignored.
 */
export function parseNewestFullRelease(body: string, packageName: string): FullRelease | null {
	const fileNamePattern = new RegExp(
		`^${escapeRegExp(packageName)}-(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)-full\\.nupkg$`,
	);
	const releases: FullRelease[] = [];
	for (const line of body.replace(/^\uFEFF/, "").split(/\r?\n/)) {
		const match = RELEASE_LINE.exec(line.trim());
		if (!match) continue;
		const [, sha1 = "", fileName = "", sizeText = ""] = match;
		const version = valid(fileNamePattern.exec(fileName)?.[1] ?? null);
		const size = Number(sizeText);
		if (!version || !Number.isSafeInteger(size) || size <= 0 || size > MAX_PACKAGE_BYTES) {
			continue;
		}
		releases.push({ sha1, fileName, size, version });
	}
	return releases.sort((a, b) => rcompare(a.version, b.version))[0] ?? null;
}

async function fileMatches(filePath: string, release: FullRelease): Promise<boolean> {
	if ((await fileSize(filePath)) !== release.size) return false;
	const hash = createHash("sha1");
	await hashFileInto(hash, filePath);
	return hash.digest("hex") === release.sha1.toLowerCase();
}

async function fileSize(filePath: string): Promise<number> {
	try {
		return (await stat(filePath)).size;
	} catch {
		return 0;
	}
}

async function hashFileInto(hash: Hash, filePath: string): Promise<void> {
	for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
}
