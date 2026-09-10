import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import type { GitClient, GitPatchFile } from "@anaconda-agentic-desktop/git-client";
import {
	GitFileTooLargeError,
	GitNotDetectedError,
	createGitClient,
} from "@anaconda-agentic-desktop/git-client";
import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { GitStatus } from "../contracts/schemas.js";

/** The slice of `GitClient` the service actually uses; `GitClient` satisfies it. */
export type GitClientSlice = Pick<
	GitClient,
	"status" | "version" | "createWorkingDirectoryPatch" | "getFileContents"
>;

export interface GitServiceOptions {
	readonly logger: MainSdkLogger;
	/**
	 * Resolves the absolute workspace folder paths git operations are
	 * allowed to run in, or `null` when the workspaces capability is
	 * unavailable. Resolved per call (request-time), so provider boot
	 * order is irrelevant.
	 */
	readonly getWorkspaceFolderPaths: () => Promise<readonly string[] | null>;
	/**
	 * Base directory for generated patch files. Defaults to `os.tmpdir()`
	 * inside git-client; the shell passes the Electron temp directory.
	 */
	readonly tempDir?: string;
	/** Factory for the shared client. Overridable in tests. */
	readonly createClient?: () => GitClientSlice;
}

/**
 * Defense in depth for a renderer-reachable file-read primitive: the contract
 * only validates non-empty strings, so the service itself rejects absolute
 * paths and paths that resolve outside `workingDirectory`. Git would reject
 * escapes too (`OutsideRepository`), but not before an unnecessary spawn —
 * and absolute paths inside the working directory would read fine.
 */
function assertInsideWorkingDirectory(workingDirectory: string, repoRelativePath: string): void {
	const resolvedFrom = relative(workingDirectory, resolve(workingDirectory, repoRelativePath));
	// `startsWith("..")` alone would falsely reject an in-tree file named
	// `..foo` — a legal name on macOS/Linux.
	if (
		isAbsolute(repoRelativePath) ||
		resolvedFrom === ".." ||
		resolvedFrom.startsWith(`..${sep}`)
	) {
		throw new FeatureError(
			`"${repoRelativePath}" is not a path inside the working directory.`,
			"VALIDATION",
		);
	}
}

/** Whether `candidate` is `folder` itself or a path inside it. */
function isSameOrWithin(folder: string, candidate: string): boolean {
	const relativePath = relative(folder, candidate);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

function createDefaultClient(logger: MainSdkLogger): GitClientSlice {
	// git-client's `GitLogger` is the narrow `{ error }` interface, which
	// `MainSdkLogger` satisfies directly.
	return createGitClient({ logger });
}

/**
 * Status service over git-client.
 *
 * Stateless, backed by one shared client: git-client resolves the git binary
 * lazily and memoizes it per instance, so the binary resolution cost is paid
 * once per service, not per call. Each `status` call selects its working
 * directory via the client's `cwd` option.
 *
 * Semantics inherited from git-client and deliberately not deviated from:
 * - `null` means `git status` exited 128 — a missing directory and a
 *   non-repo directory are indistinguishable.
 * - `GitNotDetectedError` (no git binary on PATH) is the one error mapped to
 *   a `FeatureError` so its message survives the IPC boundary; every other
 *   error propagates unwrapped (the IPC boundary scrubs generic errors, and
 *   git-client logs the detail via the adapted logger).
 *
 * Workspace containment: every directory-taking call (`status`,
 * `createPatch`, `getDiffContents`) resolves the workspace folders
 * per request and rejects with a `VALIDATION` FeatureError unless the
 * directory equals or is inside one of them — this choke point covers both
 * the IPC channels and the `kilo-git://` protocol handler in one place.
 * The capability is resolved per call, so boot order never matters, and an
 * absent capability fails closed (kilo-ui is bundled and always booted by
 * the time renderer requests exist). Legitimate renderer traffic always
 * passes workspace folder paths, so the guard never trips in normal use.
 *
 * `available` is a probe, so its error semantics differ from `status` on
 * purpose: every failure collapses to `false` — including
 * `GitNotDetectedError`, which `version()` can throw synchronously because
 * binary resolution runs before the memoized promise exists, hence
 * `try { await }` rather than a `.catch()` — and `false` is an expected
 * outcome, not an error, so nothing is logged. `version()` memoizes its
 * promise per client (rejections included) and the service shares one
 * client, so the probe result is effectively cached for the app's lifetime.
 */
export class GitService {
	readonly #client: GitClientSlice;
	readonly #getWorkspaceFolderPaths: () => Promise<readonly string[] | null>;
	readonly #tempDir: string | undefined;
	/**
	 * Patch file paths handed to callers but not yet released. The protocol
	 * handler owns a patch's lifetime (release on stream close/cancel);
	 * this set is only the dispose-time sweep of anything still in flight
	 * when the plugin tears down — orphaned files after a hard quit are
	 * OS-reaped (the OS temp directory).
	 */
	readonly #inFlightPatchPaths = new Set<string>();

	constructor(options: GitServiceOptions) {
		this.#client = options.createClient?.() ?? createDefaultClient(options.logger);
		this.#getWorkspaceFolderPaths = options.getWorkspaceFolderPaths;
		this.#tempDir = options.tempDir;
	}

	/**
	 * Resolve the allowed workspace folders and reject `directory` unless
	 * it equals or is inside one of them. `null` (capability absent) is a
	 * rejection too — containment fails closed.
	 */
	async #assertWithinWorkspaceFolders(directory: string): Promise<void> {
		const folderPaths = await this.#getWorkspaceFolderPaths();
		if (folderPaths === null) {
			throw new FeatureError(
				"Workspaces are unavailable, so the directory cannot be verified as part of a workspace.",
				"VALIDATION",
			);
		}
		if (!folderPaths.some((folderPath) => isSameOrWithin(folderPath, directory))) {
			throw new FeatureError(`"${directory}" is not inside a workspace folder.`, "VALIDATION");
		}
	}

	async status(workingDirectory: string): Promise<GitStatus | null> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const result = await this.#client.status({ cwd: workingDirectory });
			if (result === null) {
				return null;
			}
			// `WorkingDirectoryStatus.files` is `ReadonlyArray` in git-client
			// while the contract's input type is a mutable array — a shallow
			// spread is the only mapping needed.
			return {
				...result,
				workingDirectory: { files: [...result.workingDirectory.files] },
			};
		} catch (error) {
			if (error instanceof GitNotDetectedError) {
				throw new FeatureError(
					"Git executable not found. Install git and make sure it is on your PATH.",
					"BUSINESS",
				);
			}
			throw error;
		}
	}

	/**
	 * Generate the complete working-tree patch for `cwd` without touching the
	 * user's real index (git-client stages into a throwaway temp index).
	 * `null` = not a git repository. The caller owns the returned patch file:
	 * `releasePatch(patchPath)` removes it (the protocol handler hooks
	 * stream close for that), and anything still in flight at teardown is
	 * swept by {@link dispose}.
	 */
	async createPatch(options: { readonly cwd: string }): Promise<GitPatchFile | null> {
		await this.#assertWithinWorkspaceFolders(options.cwd);
		try {
			const patch = await this.#client.createWorkingDirectoryPatch({
				cwd: options.cwd,
				...(this.#tempDir ? { tempDir: this.#tempDir } : {}),
			});
			if (patch === null) return null;
			this.#inFlightPatchPaths.add(patch.patchPath);
			return patch;
		} catch (error) {
			if (error instanceof GitNotDetectedError) {
				throw new FeatureError(
					"Git executable not found. Install git and make sure it is on your PATH.",
					"BUSINESS",
				);
			}
			throw error;
		}
	}

	/** Remove a patch file and release it from the dispose sweep. */
	async releasePatch(patchPath: string): Promise<void> {
		await rm(patchPath, { force: true });
		this.#inFlightPatchPaths.delete(patchPath);
	}

	/**
	 * Both sides of a working-tree file's contents for diff hunk expansion.
	 * Null sides mean that side is absent (new/untracked file, deleted file,
	 * unborn HEAD); a side over 50 MiB rejects with a `FeatureError`.
	 */
	async getDiffContents(options: {
		readonly workingDirectory: string;
		readonly path: string;
		readonly oldPath?: string | undefined;
	}): Promise<{ oldContents: string | null; newContents: string | null }> {
		await this.#assertWithinWorkspaceFolders(options.workingDirectory);
		assertInsideWorkingDirectory(options.workingDirectory, options.path);
		if (options.oldPath !== undefined) {
			assertInsideWorkingDirectory(options.workingDirectory, options.oldPath);
		}
		try {
			return await this.#client.getFileContents({
				cwd: options.workingDirectory,
				path: options.path,
				...(options.oldPath ? { oldPath: options.oldPath } : {}),
			});
		} catch (error) {
			if (error instanceof GitNotDetectedError) {
				throw new FeatureError(
					"Git executable not found. Install git and make sure it is on your PATH.",
					"BUSINESS",
				);
			}
			if (error instanceof GitFileTooLargeError) {
				throw new FeatureError(`"${error.path}" is too large to expand.`, "BUSINESS");
			}
			throw error;
		}
	}

	/** Best-effort sweep of in-flight patch files (plugin teardown). */
	async dispose(): Promise<void> {
		for (const patchPath of [...this.#inFlightPatchPaths]) {
			await this.releasePatch(patchPath).catch(() => undefined);
		}
	}

	async available(): Promise<boolean> {
		try {
			// Declared `Promise<string>`, but the probe does not trust the
			// declared type across the client seam: a falsey resolved value
			// means no usable version, so it collapses to `false` too.
			return Boolean(await this.#client.version());
		} catch {
			return false;
		}
	}
}
