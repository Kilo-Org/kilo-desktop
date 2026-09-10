import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";
import { globbyStream } from "globby";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

import type { FileGitStatusEntry, FileReadResult } from "../../contracts/schemas.js";

const DEFAULT_SCAN_LIMIT = 25_000;
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
 */
export class FilesService {
	private readonly scanLimit: number;
	private readonly textLimitBytes: number;
	private readonly imageLimitBytes: number;

	constructor(private readonly options: FilesServiceOptions) {
		this.scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT;
		this.textLimitBytes = options.textLimitBytes ?? DEFAULT_TEXT_LIMIT_BYTES;
		this.imageLimitBytes = options.imageLimitBytes ?? DEFAULT_IMAGE_LIMIT_BYTES;
	}

	async list(workspaceDirectory: string): Promise<{ paths: string[]; truncated: boolean }> {
		const root = await this.authorizedRoot(workspaceDirectory);
		const paths: string[] = [];
		let truncated = false;

		for await (const entry of globbyStream("**/*", {
			cwd: root,
			dot: true,
			followSymbolicLinks: false,
			gitignore: true,
			ignore: [".git", ".git/**"],
			markDirectories: true,
			onlyFiles: false,
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
			uniquePaths.map(async (relativePath) => {
				if (!validRelativePath(relativePath)) return null;
				try {
					const target = await realpath(path.resolve(root, ...relativePath.split(/[\\/]+/u)));
					if (!inside(root, target) || !(await stat(target)).isFile()) return null;
					return relativePath;
				} catch {
					return null;
				}
			}),
		);
		return results.filter((relativePath): relativePath is string => relativePath !== null);
	}

	async read(workspaceDirectory: string, relativePath: string): Promise<FileReadResult> {
		const target = await this.fileTarget(workspaceDirectory, relativePath);
		const metadata = await stat(target);
		const byteLength = metadata.size;
		const extension = path.extname(target).toLowerCase();

		if (DEFERRED_PREVIEW_EXTENSIONS.has(extension)) {
			return { kind: "unsupported", reason: "preview-deferred", byteLength };
		}

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
