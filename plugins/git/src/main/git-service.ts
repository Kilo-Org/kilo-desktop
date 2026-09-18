import type { MainSdkLogger } from "@kilo-desktop/feature-sdk";
import { FeatureError } from "@kilo-desktop/feature-sdk";
import type { GitClient, GitPatchFile } from "@kilo-desktop/git-client";
import {
	GitErrorCode,
	GitFileTooLargeError,
	GitNotDetectedError,
	createGitClient,
	isGitError,
} from "@kilo-desktop/git-client";
import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
	GitBranch,
	GitBranchesResult,
	GitRepositoryType,
	GitStatus,
} from "../contracts/schemas.js";
import type { IBranch, RepositoryType } from "@kilo-desktop/git-client";
import { findDefaultBranch } from "./find-default-branch.js";

const REMOTE_REF_PREFIX = "refs/remotes/";
const BRANCH_REF_PREFIXES = ["refs/heads", "refs/remotes"] as const;
/** The only remote this plugin's default-branch detection looks at (no fork model). */
const DEFAULT_REMOTE_NAME = "origin";
/** The max number of recent branches to report (GitHub Desktop's `RecentBranchesLimit`). */
const RECENT_BRANCHES_LIMIT = 5;
const DEFAULT_BRANCH_CONFIG_KEY = "init.defaultBranch";

function branchKind(ref: string): GitBranch["kind"] {
	return ref.startsWith(REMOTE_REF_PREFIX) ? "remote" : "local";
}

/** Drop remotes that a local branch already tracks (same short name as `upstream`). */
function visibleBranches(branches: ReadonlyArray<IBranch>): GitBranch[] {
	const localUpstreams = new Set(
		branches.flatMap((branch) =>
			branchKind(branch.ref) === "local" && branch.upstream !== null ? [branch.upstream] : [],
		),
	);
	return branches.flatMap((branch) => {
		const kind = branchKind(branch.ref);
		if (kind === "remote" && localUpstreams.has(branch.name)) return [];
		return [{ ...branch, kind }];
	});
}

/** The slice of `GitClient` the service actually uses; `GitClient` satisfies it. */
export type GitClientSlice = Pick<
	GitClient,
	| "status"
	| "version"
	| "branches"
	| "createBranch"
	| "checkoutBranch"
	| "repositoryType"
	| "createWorkingDirectoryPatch"
	| "getFileContents"
	| "remoteHead"
	| "globalConfigValue"
	| "recentBranches"
>;

/**
 * The visible branches' recently checked-out local branch names, in reflog
 * order: the default branch is excluded (it has its own group), names with
 * no matching local branch are dropped (deleted), and the list caps at
 * {@link RECENT_BRANCHES_LIMIT} — GitHub Desktop's `refreshRecentBranches`.
 */
function recentBranchNamesOf(
	branches: ReadonlyArray<IBranch>,
	recentNames: ReadonlyArray<string>,
	defaultBranch: string | undefined,
): string[] {
	const localNames = new Set(
		branches.flatMap((branch) => (branchKind(branch.ref) === "local" ? [branch.name] : [])),
	);

	const recentBranches: string[] = [];
	for (const name of recentNames) {
		// The default branch already has its own section in the branch
		// list so we exclude it here.
		if (name === defaultBranch) {
			continue;
		}

		// This means the recent branch has been deleted. That's fine.
		if (!localNames.has(name)) {
			continue;
		}

		recentBranches.push(name);

		if (recentBranches.length >= RECENT_BRANCHES_LIMIT) {
			break;
		}
	}

	return recentBranches;
}

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
 * The one error mapped to a `FeatureError` across every method: no git
 * binary means the message must survive the IPC boundary. Everything else
 * propagates unwrapped (the IPC boundary scrubs generic errors, and
 * git-client logs the detail via the adapted logger).
 */
function gitNotDetectedToFeatureError(error: unknown): unknown {
	if (error instanceof GitNotDetectedError) {
		return new FeatureError(
			"Git executable not found. Install git and make sure it is on your PATH.",
			"BUSINESS",
		);
	}
	return error;
}

/**
 * Expected user-facing checkout failures: git's parsed description (the
 * "already exists" / "local changes overwritten" copy) must survive the IPC
 * boundary, so they map to `FeatureError`s; anything else propagates
 * unwrapped (scrubbed at IPC, logged by git-client).
 */
function checkoutErrorToFeatureError(error: unknown): unknown {
	if (isGitError(error, GitErrorCode.BranchAlreadyExists)) {
		return new FeatureError(error.result.gitErrorDescription ?? error.message, "BUSINESS");
	}
	if (isGitError(error, GitErrorCode.LocalChangesOverwritten)) {
		return new FeatureError(error.result.gitErrorDescription ?? error.message, "BUSINESS");
	}
	return gitNotDetectedToFeatureError(error);
}

/**
 * Git status/branch service over git-client.
 *
 * Stateless, backed by one shared client: git-client resolves the git binary
 * lazily and memoizes it per instance, so the binary resolution cost is paid
 * once per service, not per call. Every method selects its working directory
 * via the client's `cwd` option.
 *
 * Semantics inherited from git-client and deliberately not deviated from:
 * - `null` from `status`/`branches` means the probe exited 128 — a missing
 *   directory and a non-repo directory are indistinguishable. `branches`
 *   runs its probes (local+remote refs, status for the current branch,
 *   plus the grouping inputs: remote HEAD, `init.defaultBranch` global
 *   config, recent reflog names) in parallel and collapses to `null`
 *   when the refs or status probe reports not-a-repo — the grouping
 *   probes resolve their failure modes as data, so they never turn a
 *   regular repo into `null`. Remote-tracking refs that a local branch
 *   already tracks are omitted so the switcher shows one row per
 *   checkout target, and the result carries the detected `defaultBranch`
 *   (Desktop's `findDefaultBranch` priority, remote always `origin`)
 *   and `recentBranches` (reflog order, local-only, default excluded,
 *   deleted dropped, capped at 5).
 *   `kind: "remote"` checkout uses `git checkout --track`.
 * - `repositoryType` is the explicit replacement for that accidental
 *   guardrail: one `git rev-parse` probe classifies the directory as
 *   `missing`/`unsafe`/`bare`/`regular` (ported from GitHub Desktop), and
 *   the renderer gates the branch selector on `kind === "regular"` before
 *   the data probes ever run. It never resolves `null` — `missing` is an
 *   explicit kind, and `unsafe` crosses the contract so a trust flow can
 *   be added later without schema changes.
 * - `GitNotDetectedError` (no git binary on PATH) is mapped to a
 *   `FeatureError` on every method so its message survives the IPC boundary;
 *   every other unexpected error propagates unwrapped (the IPC boundary
 *   scrubs generic errors, and git-client logs the detail via the adapted
 *   logger).
 * - `checkout` additionally maps the two expected user-facing failures
 *   (`BranchAlreadyExists`, `LocalChangesOverwritten`) to `FeatureError`s
 *   carrying git's parsed descriptions, so the UI can surface them. With
 *   `create`, the new branch is based on `startPoint` when given — the
 *   default branch while branching off it, per Desktop's dialog — and on
 *   the current HEAD when omitted.
 *
 * Workspace containment: every directory-taking call (`status`,
 * `branches`, `checkout`, `createPatch`, `getDiffContents`) resolves the
 * workspace folders per request and rejects with a `VALIDATION` FeatureError
 * unless the directory equals or is inside one of them — this choke point
 * covers both the IPC channels and the `kilo-git://` protocol handler in one
 * place. The capability is resolved per call, so boot order never matters,
 * and an absent capability fails closed (kilo-ui is bundled and always
 * booted by the time renderer requests exist). Legitimate renderer traffic
 * always passes workspace folder paths, so the guard never trips in normal
 * use.
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
			throw gitNotDetectedToFeatureError(error);
		}
	}

	async branches(workingDirectory: string): Promise<GitBranchesResult | null> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			// Independent probes, spawned in parallel rather than serially:
			// branch refs, status for the current branch (`for-each-ref`
			// alone cannot report it), and the Desktop-parity grouping
			// inputs (remote HEAD, configured default, recent reflog
			// names). The grouping probes are failure-tolerant by design —
			// symref 128 → null, config 1 → null, reflog 128 → [] — so
			// only branches/status keep the null-means-not-a-repo gate.
			// The recent fetch asks for one more than the limit because
			// the default branch often appears in the reflog and is
			// filtered out afterwards.
			const [branches, status, remoteHead, configuredDefault, recentNames] = await Promise.all([
				this.#client.branches({ cwd: workingDirectory, prefixes: BRANCH_REF_PREFIXES }),
				this.#client.status({ cwd: workingDirectory }),
				this.#client.remoteHead(DEFAULT_REMOTE_NAME, { cwd: workingDirectory }),
				this.#client.globalConfigValue(DEFAULT_BRANCH_CONFIG_KEY),
				this.#client.recentBranches(RECENT_BRANCHES_LIMIT + 1, { cwd: workingDirectory }),
			]);
			if (branches === null || status === null) return null;
			const visible = visibleBranches(branches);
			const defaultBranch = findDefaultBranch(visible, remoteHead, configuredDefault);
			return {
				// Absent on detached HEAD and unborn repositories — matches the
				// schema's optional `currentBranch`.
				...(status.currentBranch === undefined ? {} : { currentBranch: status.currentBranch }),
				branches: visible,
				// Absent when no branch matches the detected default name.
				...(defaultBranch === undefined ? {} : { defaultBranch }),
				recentBranches: recentBranchNamesOf(branches, recentNames, defaultBranch),
			};
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * The explicit repository-type probe the selector gate runs on: a
	 * single `git rev-parse` decides `missing`/`unsafe`/`bare`/`regular`,
	 * so non-regular workspaces never spawn the failing data probes.
	 */
	async repositoryType(workingDirectory: string): Promise<GitRepositoryType> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			const result: RepositoryType = await this.#client.repositoryType(workingDirectory);
			// The discriminated unions of git-client's `RepositoryType` and
			// the contract's `GitRepositoryType` align member-for-member;
			// `tsc` enforces the alignment at this assignment.
			return result;
		} catch (error) {
			throw gitNotDetectedToFeatureError(error);
		}
	}

	/**
	 * Check out a branch. `kind: "remote"` creates a local branch that
	 * tracks the named remote-tracking ref. With `create`, first create the
	 * branch off `startPoint` — or the current HEAD when omitted (Desktop's
	 * create-then-checkout flow, where `startPoint: null` means HEAD).
	 */
	async checkout(
		workingDirectory: string,
		branch: string,
		create?: boolean,
		startPoint?: string,
		kind?: GitBranch["kind"],
	): Promise<void> {
		await this.#assertWithinWorkspaceFolders(workingDirectory);
		try {
			if (create) {
				await this.#client.createBranch(branch, startPoint, { cwd: workingDirectory });
			}
			await this.#client.checkoutBranch(branch, {
				cwd: workingDirectory,
				...(kind === "remote" ? { track: true } : {}),
			});
		} catch (error) {
			throw checkoutErrorToFeatureError(error);
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
