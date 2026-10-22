import { createHash } from "node:crypto";
import fs from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";
import { globbyStream } from "globby";

import { FeatureError } from "@kilo-desktop/feature-sdk";

import {
	type BinaryTableFormat,
	type FileGitStatusEntry,
	type FileLinkResolution,
	FILE_LINK_MATCH_LIMIT,
	type FileReadResult,
	TABLE_LIMIT_BYTES,
} from "../../contracts/schemas.js";

const DEFAULT_SCAN_LIMIT = 25_000;
const DEFAULT_RESOLVE_SCAN_LIMIT = 1000;
/**
 * Gitignored paths are skipped by the walk itself (`gitignore: true`), so dependency
 * and environment trees such as `node_modules` or `.venv` never use up the scan limit.
 * Worktrees live under `{repo}/.kilo/worktrees`; anchoring that ignore to the walk root
 * keeps a main repo's search out of its worktrees and a worktree's out of nested ones.
 */
const LINK_WALK_IGNORES = ["**/.git/**", ".kilo/worktrees/**"];
const GLOB_SPECIAL_CHARACTERS = /[[\]()*?!{}]/gu;
const DEFAULT_TEXT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = new Map<string, string>([
	[".avif", "image/avif"],
	[".gif", "image/gif"],
	[".ico", "image/x-icon"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".png", "image/png"],
	[".svg", "image/svg+xml"],
	[".webp", "image/webp"],
]);

const DEFERRED_PREVIEW_EXTENSIONS = new Set([".htm", ".html", ".pdf"]);

/** Filesystem module used for the workspace scan; injectable as a test seam. */
type FileSystem = typeof fs;

// Arrow IPC files/Feather are deliberately absent: Sift's binary loader only
// accepts uncompressed Arrow IPC streams, which have no reliable extension.
const BINARY_TABLE_TYPES = new Map<string, BinaryTableFormat>([[".parquet", "parquet"]]);

const PARQUET_MAGIC = Buffer.from("PAR1", "latin1");

function hasTableMagic(format: BinaryTableFormat, contents: Buffer): boolean {
	switch (format) {
		case "parquet":
			return (
				contents.byteLength >= PARQUET_MAGIC.byteLength * 2 &&
				contents.subarray(0, PARQUET_MAGIC.byteLength).equals(PARQUET_MAGIC) &&
				contents.subarray(-PARQUET_MAGIC.byteLength).equals(PARQUET_MAGIC)
			);
	}
}

export interface FilesServiceOptions {
	readonly authorize: (canonicalWorkspaceDirectory: string) => Promise<void>;
	/**
	 * Best-effort git status lookup (already gated on the workspace being a
	 * git worktree root). Runs only after `authorize`, so renderer-supplied
	 * directories are authorized before any git probe. Implementations may
	 * reject; the service degrades a rejected lookup to `null`.
	 */
	readonly gitStatus: (canonicalWorkspaceDirectory: string) => Promise<FileGitStatusEntry[] | null>;
	readonly scanLimit?: number;
	readonly textLimitBytes?: number;
	readonly imageLimitBytes?: number;
	/**
	 * Filesystem module backing the workspace scan (defaults to `node:fs`).
	 * Test seam: lets the scan's traversal-error handling run without real
	 * POSIX permission bits.
	 */
	readonly fileSystem?: FileSystem;
	readonly tableLimitBytes?: number;
	/** Maximum basename hits collected per link lookup before the search reports truncation. */
	readonly resolveScanLimit?: number;
}

function sha256(contents: Uint8Array): string {
	return createHash("sha256").update(contents).digest("hex");
}

function inside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validRelativePath(relativePath: string): boolean {
	if (
		path.isAbsolute(relativePath) ||
		path.posix.isAbsolute(relativePath) ||
		path.win32.isAbsolute(relativePath)
	) {
		return false;
	}
	const segments = relativePath.split(/[\\/]+/u);
	return segments.length > 0 && segments.every((segment) => segment !== "" && segment !== "..");
}

function normalizeLinkPath(relativePath: string): string {
	return relativePath.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "");
}

/** Escapes glob metacharacters with character classes, which globby honours on every platform. */
function escapeGlobSegment(segment: string): string {
	return segment.replace(GLOB_SPECIAL_CHARACTERS, (character) => `[${character}]`);
}

function isSuffixLinkMatch(candidate: string, linkPath: string): boolean {
	return candidate === linkPath || candidate.endsWith(`/${linkPath}`);
}

function byPathLengthThenName(left: string, right: string): number {
	return left.length - right.length || left.localeCompare(right);
}

interface BasenameWalk {
	readonly paths: string[];
	readonly truncated: boolean;
}

function featureErrorForFilesystem(error: unknown, message: string): FeatureError {
	if (error instanceof FeatureError) return error;
	if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
		return new FeatureError("File not found.", "NOT_FOUND");
	}
	return new FeatureError(message, "VALIDATION");
}

/**
 * Owns the security boundary between a renderer-requested workspace/path and
 * the host filesystem. Every operation re-authorizes and canonicalizes its
 * root, and every file target is checked after realpath so symlinks cannot
 * escape. The service is intentionally stateless; revisions are content
 * hashes supplied by callers, which keeps concurrent agent edits observable.
 * Batched existence checks authorize their root once, then canonicalize all
 * independent candidates in parallel against that same security boundary.
 * Git status is the one best-effort operation: it shares the authorization
 * boundary (authorization failures still reject), while a failure of the
 * injected lookup itself degrades to `null` instead of failing the operation.
 * Binary table files (Parquet) are all-or-nothing under a byte cap
 * and container-magic checked; decoding stays in the renderer so no file
 * contents are parsed in main.
 */
export class FilesService {
	private readonly scanLimit: number;
	private readonly textLimitBytes: number;
	private readonly imageLimitBytes: number;
	private readonly fileSystem: FileSystem;
	private readonly tableLimitBytes: number;
	private readonly resolveScanLimit: number;
	private readonly pendingBasenameWalks = new Map<string, Promise<BasenameWalk>>();

	constructor(private readonly options: FilesServiceOptions) {
		this.scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT;
		this.textLimitBytes = options.textLimitBytes ?? DEFAULT_TEXT_LIMIT_BYTES;
		this.imageLimitBytes = options.imageLimitBytes ?? DEFAULT_IMAGE_LIMIT_BYTES;
		this.fileSystem = options.fileSystem ?? fs;
		this.tableLimitBytes = options.tableLimitBytes ?? TABLE_LIMIT_BYTES;
		this.resolveScanLimit = options.resolveScanLimit ?? DEFAULT_RESOLVE_SCAN_LIMIT;
	}

	async list(workspaceDirectory: string): Promise<{ paths: string[]; truncated: boolean }> {
		const root = await this.authorizedRoot(workspaceDirectory);
		// The walk below suppresses traversal errors, which would turn an
		// unreadable root into a silently empty listing. Read the root once
		// so root-level failures still surface; only descendants are
		// best-effort. `opendir` (not `access`) because Windows `access`
		// ignores ACLs.
		try {
			await (await this.fileSystem.promises.opendir(root)).close();
		} catch (error) {
			throw featureErrorForFilesystem(error, "Workspace directory is not readable.");
		}
		const paths: string[] = [];
		let truncated = false;

		for await (const entry of globbyStream("**/*", {
			cwd: root,
			dot: true,
			followSymbolicLinks: false,
			ignore: [".git", ".git/**"],
			markDirectories: true,
			onlyFiles: false,
			fs: this.fileSystem,
			// A directory can vanish or be locked mid-walk (temp dirs, AV scans,
			// editors). fast-glob only suppresses ENOENT by default, so a
			// transient EPERM/EACCES from `scandir` would fail the entire
			// listing; skip the offending directory instead.
			suppressErrors: true,
		})) {
			if (paths.length === this.scanLimit) {
				truncated = true;
				break;
			}
			paths.push(String(entry).replaceAll("\\", "/"));
		}

		paths.sort((left, right) => left.localeCompare(right));
		return { paths, truncated };
	}

	async existingPaths(
		workspaceDirectory: string,
		relativePaths: readonly string[],
	): Promise<string[]> {
		const root = await this.authorizedRoot(workspaceDirectory);
		const uniquePaths = [...new Set(relativePaths)];
		const results = await Promise.all(
			uniquePaths.map(async (relativePath) =>
				(await this.isContainedFile(root, relativePath)) ? relativePath : null,
			),
		);
		return results.filter((relativePath): relativePath is string => relativePath !== null);
	}

	/**
	 * Resolves a link written by a model or a user against the workspace root.
	 * An exact root file wins. Otherwise every file with the same basename is
	 * walked (shared across concurrent callers) and kept only when its path ends
	 * with the link on a `/` boundary, so `lib/a.ts` never answers `src/a.ts`.
	 */
	async resolveFileLink(
		workspaceDirectory: string,
		relativePath: string,
	): Promise<FileLinkResolution> {
		const linkPath = normalizeLinkPath(relativePath);
		if (!validRelativePath(linkPath)) {
			throw new FeatureError("File path must stay within the workspace.", "VALIDATION");
		}
		const root = await this.authorizedRoot(workspaceDirectory);
		if (await this.isContainedFile(root, linkPath)) {
			return { kind: "exact", paths: [linkPath], truncated: false };
		}

		const basename = linkPath.split("/").at(-1) ?? linkPath;
		const walk = await this.basenameWalk(root, basename);
		const verified = await Promise.all(
			walk.paths
				.filter((candidate) => isSuffixLinkMatch(candidate, linkPath))
				.map(async (candidate) =>
					(await this.isContainedFile(root, candidate)) ? candidate : null,
				),
		);
		const paths = verified
			.filter((candidate): candidate is string => candidate !== null)
			.toSorted(byPathLengthThenName)
			.slice(0, FILE_LINK_MATCH_LIMIT);
		return {
			kind: paths.length > 0 ? "matches" : "none",
			paths,
			truncated: walk.truncated,
		};
	}

	private basenameWalk(root: string, basename: string): Promise<BasenameWalk> {
		const key = `${root}\0${basename}`;
		const pending = this.pendingBasenameWalks.get(key);
		if (pending) return pending;
		const walk = this.walkBasename(root, basename).finally(() => {
			this.pendingBasenameWalks.delete(key);
		});
		this.pendingBasenameWalks.set(key, walk);
		return walk;
	}

	private async walkBasename(root: string, basename: string): Promise<BasenameWalk> {
		const paths: string[] = [];
		let truncated = false;
		for await (const entry of globbyStream(`**/${escapeGlobSegment(basename)}`, {
			cwd: root,
			dot: true,
			followSymbolicLinks: false,
			onlyFiles: true,
			gitignore: true,
			ignore: LINK_WALK_IGNORES,
			fs: this.fileSystem,
			suppressErrors: true,
		})) {
			if (paths.length === this.resolveScanLimit) {
				truncated = true;
				break;
			}
			paths.push(String(entry).replaceAll("\\", "/"));
		}
		return { paths, truncated };
	}

	private async isContainedFile(root: string, relativePath: string): Promise<boolean> {
		if (!validRelativePath(relativePath)) return false;
		try {
			const target = await realpath(path.resolve(root, ...relativePath.split(/[\\/]+/u)));
			return inside(root, target) && (await stat(target)).isFile();
		} catch {
			return false;
		}
	}

	async read(workspaceDirectory: string, relativePath: string): Promise<FileReadResult> {
		const target = await this.fileTarget(workspaceDirectory, relativePath);
		const metadata = await stat(target);
		const byteLength = metadata.size;
		const extension = path.extname(target).toLowerCase();

		if (DEFERRED_PREVIEW_EXTENSIONS.has(extension)) {
			return { kind: "unsupported", reason: "preview-deferred", byteLength };
		}

		const tableFormat = BINARY_TABLE_TYPES.get(extension);
		if (tableFormat) return this.readTable(target, tableFormat, byteLength);

		const imageType = IMAGE_TYPES.get(extension);
		if (imageType) {
			if (byteLength > this.imageLimitBytes) {
				return { kind: "unsupported", reason: "too-large", byteLength };
			}
			const contents = await this.readBytes(target, byteLength);
			return {
				kind: "image",
				mimeType: imageType,
				base64: contents.toString("base64"),
				byteLength,
			};
		}

		const truncated = byteLength > this.textLimitBytes;
		const contents = await this.readBytes(target, Math.min(byteLength, this.textLimitBytes));
		if (contents.includes(0)) {
			return { kind: "unsupported", reason: "binary", byteLength };
		}

		let text: string;
		try {
			const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
			text = decoder.decode(contents, { stream: truncated });
		} catch {
			return { kind: "unsupported", reason: "binary", byteLength };
		}

		return {
			kind: "text",
			contents: text,
			byteLength,
			truncated,
			...(!truncated ? { revision: sha256(contents) } : {}),
		};
	}

	async gitStatus(workspaceDirectory: string): Promise<FileGitStatusEntry[] | null> {
		const root = await this.authorizedRoot(workspaceDirectory);
		return this.options.gitStatus(root).catch(() => null);
	}

	async resolveFilePath(workspaceDirectory: string, relativePath: string): Promise<string> {
		return this.fileTarget(workspaceDirectory, relativePath);
	}

	async write(
		workspaceDirectory: string,
		relativePath: string,
		contents: string,
		expectedRevision: string,
		force = false,
	): Promise<{ status: "saved"; revision: string } | { status: "conflict"; diskRevision: string }> {
		const target = await this.fileTarget(workspaceDirectory, relativePath);
		const nextContents = Buffer.from(contents, "utf8");
		if (nextContents.byteLength > this.textLimitBytes) {
			throw new FeatureError("File contents exceed the editable size limit.", "VALIDATION");
		}
		const metadata = await stat(target);
		if (metadata.size > this.textLimitBytes) {
			throw new FeatureError("File exceeds the editable size limit.", "VALIDATION");
		}
		const diskContents = await this.readBytes(target, metadata.size);
		const diskRevision = sha256(diskContents);
		if (!force && diskRevision !== expectedRevision) {
			return { status: "conflict", diskRevision };
		}

		await atomicWriteFile(target, nextContents, { mode: metadata.mode & 0o7777 });
		return { status: "saved", revision: sha256(nextContents) };
	}

	private async authorizedRoot(workspaceDirectory: string): Promise<string> {
		if (!path.isAbsolute(workspaceDirectory)) {
			throw new FeatureError("Workspace directory must be absolute.", "VALIDATION");
		}
		try {
			const root = await realpath(workspaceDirectory);
			if (!(await stat(root)).isDirectory()) {
				throw new FeatureError("Workspace directory is not a directory.", "VALIDATION");
			}
			await this.options.authorize(root);
			return root;
		} catch (error) {
			throw featureErrorForFilesystem(error, "Workspace directory is invalid.");
		}
	}

	private async fileTarget(workspaceDirectory: string, relativePath: string): Promise<string> {
		if (!validRelativePath(relativePath)) {
			throw new FeatureError("File path must stay within the workspace.", "VALIDATION");
		}
		const root = await this.authorizedRoot(workspaceDirectory);
		try {
			const target = await realpath(path.resolve(root, ...relativePath.split(/[\\/]+/u)));
			if (!inside(root, target)) {
				throw new FeatureError("File path escapes the workspace.", "VALIDATION");
			}
			if (!(await stat(target)).isFile()) {
				throw new FeatureError("File path does not identify a file.", "VALIDATION");
			}
			return target;
		} catch (error) {
			throw featureErrorForFilesystem(error, "File path is invalid.");
		}
	}

	private async readTable(
		target: string,
		format: BinaryTableFormat,
		byteLength: number,
	): Promise<FileReadResult> {
		if (byteLength > this.tableLimitBytes) {
			return { kind: "unsupported", reason: "too-large", byteLength };
		}
		const contents = await this.readUpTo(target, byteLength + 1, this.tableLimitBytes + 1);
		if (contents.byteLength > this.tableLimitBytes) {
			return { kind: "unsupported", reason: "too-large", byteLength: contents.byteLength };
		}
		if (!hasTableMagic(format, contents)) {
			return { kind: "unsupported", reason: "invalid-table", byteLength: contents.byteLength };
		}
		return {
			kind: "table",
			format,
			base64: contents.toString("base64"),
			byteLength: contents.byteLength,
			revision: sha256(contents),
		};
	}

	/**
	 * Reads to EOF, tolerating short reads, but never more than `maxBytes`.
	 * The buffer starts at the expected size (stat size + 1, so growth is
	 * noticed without a cap-sized allocation for small files) and only grows
	 * toward `maxBytes` if the file grew after `stat`. Callers pass one byte
	 * past their limit so an oversized or growing file is detectable and a
	 * partial (footer-less) payload never passes as complete.
	 */
	private async readUpTo(target: string, initialBytes: number, maxBytes: number): Promise<Buffer> {
		const handle = await open(target, "r");
		try {
			let contents = Buffer.allocUnsafe(Math.min(initialBytes, maxBytes));
			let length = 0;
			while (length < maxBytes) {
				if (length === contents.byteLength) {
					const grown = Buffer.allocUnsafe(Math.min(contents.byteLength * 2, maxBytes));
					contents.copy(grown, 0, 0, length);
					contents = grown;
				}
				const { bytesRead } = await handle.read(
					contents,
					length,
					contents.byteLength - length,
					length,
				);
				if (bytesRead === 0) break;
				length += bytesRead;
			}
			return contents.subarray(0, length);
		} finally {
			await handle.close();
		}
	}

	private async readBytes(target: string, byteLength: number): Promise<Buffer> {
		const handle = await open(target, "r");
		try {
			const contents = Buffer.alloc(byteLength);
			const { bytesRead } = await handle.read(contents, 0, byteLength, 0);
			return contents.subarray(0, bytesRead);
		} finally {
			await handle.close();
		}
	}
}
