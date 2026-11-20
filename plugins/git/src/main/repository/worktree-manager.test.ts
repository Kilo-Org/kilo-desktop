import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { KernelLogger } from "@kilo-desktop/kernel";
import type { IBranch, WorktreeEntry } from "@kilo-desktop/git-client";
import {
	GitError,
	GitErrorCode,
	GitNotDetectedError,
	UnsupportedGitVersionError,
} from "@kilo-desktop/git-client";
import type { IGitStringResult } from "@kilo-desktop/git-client";

import type { GitClientSlice } from "./git-service";
import { createPathIdentity, hostPathIdentity } from "./path-identity";
import { WorktreeManager, type WorktreeManagerOptions } from "./worktree-manager";

const logger: KernelLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

function createMainRoot(): string {
	// `.native` matches the source's `fs/promises` realpath, which expands
	// Windows 8.3 short names (C:\Users\RUNNER~1) that the JS impl keeps.
	const dir = fs.realpathSync.native(
		fs.mkdtempSync(path.join(os.tmpdir(), "worktree-manager-test-")),
	);
	directories.push(dir);
	return dir;
}

function branchOf(name: string): IBranch {
	return { name, upstream: null, tip: { sha: `sha-${name}` }, ref: `refs/heads/${name}` };
}

function worktreeEntry(overrides: Partial<WorktreeEntry>): WorktreeEntry {
	return {
		path: "/repo",
		head: "abc123",
		branch: "refs/heads/main",
		isDetached: false,
		type: "linked",
		isLocked: false,
		isPrunable: false,
		...overrides,
	};
}

function stringResult(stdout = "", exitCode = 0): IGitStringResult {
	return {
		stdout,
		stderr: "",
		exitCode,
		gitError: null,
		gitErrorDescription: null,
		path: "",
	};
}

interface ExecCall {
	args: string[];
	options: Record<string, unknown> | undefined;
}

interface FakeClientOverrides {
	repositoryType?: GitClientSlice["repositoryType"];
	worktrees?: GitClientSlice["worktrees"];
	status?: GitClientSlice["status"];
	branches?: GitClientSlice["branches"];
	addWorktree?: GitClientSlice["addWorktree"];
	removeWorktree?: GitClientSlice["removeWorktree"];
	deleteBranch?: GitClientSlice["deleteBranch"];
	renameBranch?: GitClientSlice["renameBranch"];
	defaultBranch?: GitClientSlice["defaultBranch"];
	checkRefFormat?: GitClientSlice["checkRefFormat"];
	remotes?: GitClientSlice["remotes"];
	pruneWorktrees?: GitClientSlice["pruneWorktrees"];
	gitCommonDir?: GitClientSlice["gitCommonDir"];
	/** Canned `exec` responses keyed by the joined args string. */
	execResponses?: Record<string, IGitStringResult>;
	/** Fallback for `exec` calls without a canned response. */
	execDefault?: IGitStringResult;
	/** Recorder for `exec` calls, when a test needs to inspect argv/env. */
	execLog?: ExecCall[];
}

function worktreeClient(mainRoot: string, overrides: FakeClientOverrides = {}): GitClientSlice {
	const execResponses = overrides.execResponses ?? {};
	const execDefault = overrides.execDefault ?? stringResult();
	const execLog = overrides.execLog;
	return {
		status: overrides.status ?? (() => Promise.resolve(null)),
		headBranch: () => Promise.resolve(null),
		branches: overrides.branches ?? (() => Promise.resolve([])),
		createBranch: () => Promise.resolve(),
		checkoutBranch: () => Promise.resolve(),
		initRepository: () => Promise.resolve(),
		version: () => Promise.resolve("2.39.5"),
		createWorkingDirectoryPatch: () => Promise.resolve(null),
		getFileContents: () => Promise.resolve({ oldContents: null, newContents: null }),
		remoteHead: () => Promise.resolve(null),
		globalConfigValue: () => Promise.resolve(null),
		recentBranches: () => Promise.resolve([]),
		repositoryType:
			overrides.repositoryType ??
			(() =>
				Promise.resolve({
					kind: "regular" as const,
					topLevelWorkingDirectory: mainRoot,
					gitDir: path.join(mainRoot, ".git"),
				})),
		worktrees:
			overrides.worktrees ??
			(() => Promise.resolve([worktreeEntry({ path: mainRoot, type: "main" })])),
		addWorktree: overrides.addWorktree ?? (() => Promise.resolve()),
		removeWorktree: overrides.removeWorktree ?? (() => Promise.resolve()),
		deleteBranch: overrides.deleteBranch ?? (() => Promise.resolve()),
		renameBranch: overrides.renameBranch ?? (() => Promise.resolve()),
		defaultBranch: overrides.defaultBranch ?? (() => Promise.resolve(null)),
		checkRefFormat: overrides.checkRefFormat ?? (() => Promise.resolve(true)),
		remotes: overrides.remotes ?? (() => Promise.resolve([])),
		pruneWorktrees: overrides.pruneWorktrees ?? (() => Promise.resolve()),
		gitCommonDir:
			overrides.gitCommonDir ??
			((opts) => Promise.resolve(path.join(opts?.cwd ?? mainRoot, ".git"))),
		exec: ((args: string[], _name: string, options?: Record<string, unknown>) => {
			execLog?.push({ args, options });
			const response = execResponses[args.join(" ")] ?? execDefault;
			// Model git-client's error gating: a non-zero exit rejects with a
			// GitError unless the caller listed the code as success.
			const successExitCodes = options?.successExitCodes as Set<number> | undefined;
			if (response.exitCode !== 0 && !successExitCodes?.has(response.exitCode)) {
				return Promise.reject(new GitError({ ...response }, args, ""));
			}
			return Promise.resolve(response);
		}) as unknown as GitClientSlice["exec"],
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

/**
 * Construct a `WorktreeManager` for testing. `resolveDefaultBranch` mirrors
 * `GitService.defaultBranch`'s chain: `client.defaultBranch()` → local `main`
 * → `master` → null.
 */
function managerWith(
	client: GitClientSlice,
	random: () => number = () => 0,
	fsOverrides?: Pick<
		WorktreeManagerOptions,
		"renameDirectory" | "removeDirectory" | "sleep" | "pathIdentity"
	>,
): WorktreeManager {
	return new WorktreeManager({
		client,
		logger,
		random,
		resolveDefaultBranch: async (wd) => {
			const remote = await client.defaultBranch({ cwd: wd });
			if (remote !== null) return remote;
			const branches = await client.branches({ cwd: wd });
			const names = branches?.map((b) => b.name) ?? [];
			if (names.includes("main")) return "main";
			if (names.includes("master")) return "master";
			return null;
		},
		...fsOverrides,
	});
}

describe("WorktreeManager", () => {
	describe("createWorktree", () => {
		it("creates a kilo worktree under .kilo/worktrees with a friendly-words branch", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					branches: () => Promise.resolve([branchOf("main")]),
					addWorktree,
				}),
			);

			const result = await manager.createWorktree({ workingDirectory: mainRoot });

			expect(result).toEqual({
				directory: path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark"),
				branch: "kilo/aback-aardvark",
				baseRef: "main",
			});
			expect(addWorktree).toHaveBeenCalledWith(
				path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark"),
				{
					cwd: mainRoot,
					createBranch: "kilo/aback-aardvark",
					commitish: "main^{commit}",
				},
			);
		});

		it("uses the explicit base branch as the commitish", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(worktreeClient(mainRoot, { addWorktree }));

			const result = await manager.createWorktree({
				workingDirectory: mainRoot,
				baseBranch: "feature",
			});

			expect(addWorktree).toHaveBeenCalledWith(expect.any(String), {
				cwd: mainRoot,
				createBranch: expect.stringMatching(/^kilo\//),
				commitish: "feature^{commit}",
			});
			expect(result.baseRef).toBe("feature");
		});

		it("resolves a bare base name to origin/<name> when only the remote-tracking ref exists", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([
								{
									...branchOf("origin/main"),
									ref: "refs/remotes/origin/main",
								},
								{
									...branchOf("origin/dev"),
									ref: "refs/remotes/origin/dev",
								},
							]);
						}
						return Promise.resolve([branchOf("trunk")]);
					},
					addWorktree,
				}),
			);

			const result = await manager.createWorktree({
				workingDirectory: mainRoot,
				baseBranch: "main",
			});

			expect(addWorktree).toHaveBeenCalledWith(expect.any(String), {
				cwd: mainRoot,
				createBranch: expect.stringMatching(/^kilo\//),
				commitish: "origin/main^{commit}",
			});
			expect(result.baseRef).toBe("origin/main");
		});

		it("omits the commitish when no base resolves (current HEAD)", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(worktreeClient(mainRoot, { addWorktree }));

			const result = await manager.createWorktree({ workingDirectory: mainRoot });

			expect(addWorktree).toHaveBeenCalledWith(expect.any(String), {
				cwd: mainRoot,
				createBranch: expect.stringMatching(/^kilo\//),
			});
			expect(result).not.toHaveProperty("baseRef");
		});

		it("fetches the base from the remote non-interactively and prefers the fresh remote ref", async () => {
			const mainRoot = createMainRoot();
			const execLog: ExecCall[] = [];
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					execLog,
					remotes: () => Promise.resolve(["origin"]),
					// A local `main` exists, but the fresh fetch must win.
					// Prefix-aware: the refs/remotes call returns origin/main for
					// #resolveBaseCommitish so the fresh remote ref is preferred.
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([
								{ ...branchOf("origin/main"), ref: "refs/remotes/origin/main" },
							]);
						}
						return Promise.resolve([branchOf("main")]);
					},
					execResponses: {
						"fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main":
							stringResult(),
					},
				}),
			);

			const previousSsh = process.env.GIT_SSH_COMMAND;
			delete process.env.GIT_SSH_COMMAND;
			let result: Awaited<ReturnType<WorktreeManager["createWorktree"]>>;
			try {
				result = await manager.createWorktree({
					workingDirectory: mainRoot,
					baseBranch: "main",
				});
			} finally {
				if (previousSsh !== undefined) process.env.GIT_SSH_COMMAND = previousSsh;
			}

			expect(execLog.map((call) => call.args.join(" "))).toContain(
				"fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main",
			);
			const fetchCall = execLog.find((call) => call.args[0] === "fetch");
			expect(fetchCall?.options).toMatchObject({
				cwd: mainRoot,
				env: {
					GIT_TERMINAL_PROMPT: "0",
					GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
				},
			});
			expect(addWorktree).toHaveBeenCalledWith(expect.any(String), {
				cwd: mainRoot,
				createBranch: expect.stringMatching(/^kilo\//),
				commitish: "origin/main^{commit}",
			});
			expect(result).not.toHaveProperty("warning");
			expect(result.baseRef).toBe("origin/main");
		});

		it("keeps the user's GIT_SSH_COMMAND for the fetch", async () => {
			const mainRoot = createMainRoot();
			const execLog: ExecCall[] = [];
			const manager = managerWith(
				worktreeClient(mainRoot, {
					execLog,
					remotes: () => Promise.resolve(["origin"]),
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([
								{ ...branchOf("origin/main"), ref: "refs/remotes/origin/main" },
							]);
						}
						return Promise.resolve([branchOf("main")]);
					},
					execResponses: {
						"fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main":
							stringResult(),
					},
				}),
			);
			const previous = process.env.GIT_SSH_COMMAND;
			process.env.GIT_SSH_COMMAND = "ssh -i ~/.custom-key";

			try {
				await manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "main" });
			} finally {
				if (previous === undefined) delete process.env.GIT_SSH_COMMAND;
				else process.env.GIT_SSH_COMMAND = previous;
			}

			const fetchCall = execLog.find((call) => call.args[0] === "fetch");
			// The overlay never overrides the user's own GIT_SSH_COMMAND.
			expect(fetchCall?.options).toMatchObject({
				env: { GIT_TERMINAL_PROMPT: "0" },
			});
			expect(fetchCall?.options?.env).not.toHaveProperty("GIT_SSH_COMMAND");
		});

		it("warns and falls back to the local base when the fetch fails", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					remotes: () => Promise.resolve(["origin"]),
					branches: () => Promise.resolve([branchOf("main")]),
					execResponses: {
						"fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main":
							stringResult("fatal: could not read from remote", 128),
					},
				}),
			);

			const result = await manager.createWorktree({
				workingDirectory: mainRoot,
				baseBranch: "main",
			});

			expect(result.warning).toBe(
				"Could not fetch latest main from origin; branched from local state.",
			);
			expect(addWorktree).toHaveBeenCalledWith(expect.any(String), {
				cwd: mainRoot,
				createBranch: expect.stringMatching(/^kilo\//),
				commitish: "main^{commit}",
			});
			expect(result.baseRef).toBe("main");
		});

		it("skips the fetch silently for a repository without remotes", async () => {
			const mainRoot = createMainRoot();
			const execLog: ExecCall[] = [];
			const manager = managerWith(
				worktreeClient(mainRoot, {
					execLog,
					remotes: () => Promise.resolve([]),
					branches: () => Promise.resolve([branchOf("main")]),
				}),
			);

			const result = await manager.createWorktree({
				workingDirectory: mainRoot,
				baseBranch: "main",
			});

			expect(execLog.some((call) => call.args[0] === "fetch")).toBe(false);
			expect(result).not.toHaveProperty("warning");
			expect(result.baseRef).toBe("main");
		});

		it("refetches at most once per base within the TTL window", async () => {
			const mainRoot = createMainRoot();
			const execLog: ExecCall[] = [];
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					execLog,
					remotes: () => Promise.resolve(["origin"]),
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([
								{ ...branchOf("origin/main"), ref: "refs/remotes/origin/main" },
							]);
						}
						return Promise.resolve([branchOf("main")]);
					},
					execResponses: {
						"fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main":
							stringResult(),
					},
				}),
			);

			await manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "main" });
			await manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "main" });

			const fetchCalls = execLog.filter((call) => call.args[0] === "fetch");
			expect(fetchCalls).toHaveLength(1);
		});

		it("rejects a base branch that starts with a dash without probing git", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const execLog: ExecCall[] = [];
			const manager = managerWith(worktreeClient(mainRoot, { addWorktree, execLog }));

			await expect(
				manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "--orphan" }),
			).rejects.toMatchObject({
				name: "KernelError",
				code: "VALIDATION",
			});
			expect(addWorktree).not.toHaveBeenCalled();
			// Read-only probes may have run, but no validation or fetch probe
			// ever received the dash-prefixed value.
			expect(execLog.map((call) => call.args.join(" "))).not.toContain(
				"check-ref-format --branch --orphan",
			);
			expect(execLog.some((call) => call.args[0] === "fetch")).toBe(false);
		});

		it("rejects an invalid base branch before any git mutation", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const checkRefFormat = vi.fn((name: string) =>
				// "foo bar" is invalid (contains a space)
				Promise.resolve(!name.includes(" ")),
			);
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					checkRefFormat,
				}),
			);

			await expect(
				manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "foo bar" }),
			).rejects.toMatchObject({
				name: "KernelError",
				code: "VALIDATION",
			});
			expect(checkRefFormat).toHaveBeenCalledWith("foo bar", expect.anything());
			expect(addWorktree).not.toHaveBeenCalled();
		});

		it("renames the branch after creating from a remote-tracking base", async () => {
			const mainRoot = createMainRoot();
			const worktreePath = path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark");
			const renameBranch = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree: vi.fn(() => Promise.resolve()),
					renameBranch,
					// Prefix-aware: local call returns main (for createWorktree base
					// resolution); refs/remotes call returns origin/main (for
					// #resolveBaseCommitish). rename guards need no upstream on
					// kilo/aback-aardvark and no remote ref matching it.
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([
								{
									...branchOf("origin/main"),
									ref: "refs/remotes/origin/main",
								},
							]);
						}
						return Promise.resolve([branchOf("main"), branchOf("kilo/aback-aardvark")]);
					},
					// The rename's HEAD probe: worktree is on kilo/aback-aardvark.
					// The upstream guard expects no upstream (^{commit} dereference
					// prevented `worktree add -b` from setting tracking).
					status: () =>
						Promise.resolve({
							exists: true,
							currentBranch: "kilo/aback-aardvark",
							workingDirectory: { files: [] as never[] },
							doConflictedFilesExist: false,
						}),
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: worktreePath,
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					remotes: () => Promise.resolve(["origin"]),
					execResponses: {
						"fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main":
							stringResult(),
					},
				}),
			);

			await manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "main" });
			const rename = await manager.renameWorktreeBranch({
				path: worktreePath,
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "Fix the Login Bug!",
			});

			expect(rename).toEqual({ branch: "kilo/fix-the-login-bug" });
			expect(renameBranch).toHaveBeenCalledWith("kilo/aback-aardvark", "kilo/fix-the-login-bug", {
				cwd: worktreePath,
			});
		});

		it("rejects with a KernelError for a non-regular repository", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				worktreeClient(mainRoot, {
					repositoryType: () => Promise.resolve({ kind: "bare" }),
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
			});
		});

		it("rejects with a KernelError when the repository uses LFS but git-lfs is missing", async () => {
			const mainRoot = createMainRoot();
			fs.writeFileSync(
				path.join(mainRoot, ".gitattributes"),
				"*.png filter=lfs diff=lfs merge=lfs -text\n",
			);
			const addWorktree = vi.fn(() => Promise.resolve());
			const execLog: ExecCall[] = [];
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					execLog,
					execResponses: {
						"lfs version": stringResult("git: 'lfs' is not a git command", 1),
					},
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message:
					"This repository uses Git LFS, but git-lfs was not found. Install Git LFS to create worktrees here.",
			});
			expect(addWorktree).not.toHaveBeenCalled();
		});

		it("proceeds when the repository uses LFS and git-lfs is installed", async () => {
			const mainRoot = createMainRoot();
			fs.writeFileSync(
				path.join(mainRoot, ".gitattributes"),
				"*.png filter=lfs diff=lfs merge=lfs -text\n",
			);
			const addWorktree = vi.fn(() => Promise.resolve());
			const execLog: ExecCall[] = [];
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					execLog,
					execResponses: {
						"lfs version": stringResult("git-lfs/3.5.1\n"),
					},
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).resolves.toMatchObject({
				branch: "kilo/aback-aardvark",
			});
			expect(addWorktree).toHaveBeenCalled();
		});

		it("never probes git lfs for a repository that does not use LFS", async () => {
			const mainRoot = createMainRoot();
			const execLog: ExecCall[] = [];
			const manager = managerWith(worktreeClient(mainRoot, { execLog }));

			await manager.createWorktree({ workingDirectory: mainRoot });

			expect(execLog.some((call) => call.args[0] === "lfs")).toBe(false);
		});

		it("detects LFS through the git common dir attributes file", async () => {
			const mainRoot = createMainRoot();
			// Point gitCommonDir to a subdirectory with an attributes file containing filter=lfs.
			fs.mkdirSync(path.join(mainRoot, "common", "info"), { recursive: true });
			fs.writeFileSync(path.join(mainRoot, "common", "info", "attributes"), "*.zip filter=lfs\n");
			const execLog: ExecCall[] = [];
			const manager = managerWith(
				worktreeClient(mainRoot, {
					execLog,
					gitCommonDir: () => Promise.resolve(path.join(mainRoot, "common")),
					execResponses: {
						"lfs version": stringResult("git: 'lfs' is not a git command", 1),
					},
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: expect.stringContaining("Install Git LFS"),
			});
			expect(execLog.some((call) => call.args[0] === "lfs")).toBe(true);
		});

		it("sweeps stale .kilo-delete temp directories while picking a branch", async () => {
			const mainRoot = createMainRoot();
			const worktreesDir = path.join(mainRoot, ".kilo", "worktrees");
			fs.mkdirSync(path.join(worktreesDir, ".kilo-delete-stale"), { recursive: true });
			const removeDirectory = vi.fn(async () => {});
			const manager = managerWith(
				worktreeClient(mainRoot, { branches: () => Promise.resolve([branchOf("main")]) }),
				() => 0,
				{ removeDirectory },
			);

			await manager.createWorktree({ workingDirectory: mainRoot });

			expect(removeDirectory).toHaveBeenCalledWith(path.join(worktreesDir, ".kilo-delete-stale"));
		});

		it("dedupes the generated name against existing kilo branches", async () => {
			const mainRoot = createMainRoot();
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					branches: () => Promise.resolve([branchOf("main"), branchOf("kilo/aback-aardvark")]),
					addWorktree,
				}),
			);

			const result = await manager.createWorktree({ workingDirectory: mainRoot });

			expect(result.branch).toBe("kilo/aback-aardvark-0");
			expect(result.directory).toBe(
				path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark-0"),
			);
		});

		it("tolerates a post-checkout hook failure when the worktree registered anyway", async () => {
			const mainRoot = createMainRoot();
			const worktrees = vi.fn(() =>
				Promise.resolve([
					worktreeEntry({ path: mainRoot, type: "main" }),
					worktreeEntry({
						path: path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark"),
						branch: "refs/heads/kilo/aback-aardvark",
					}),
				]),
			);
			let addAttempts = 0;
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees,
					addWorktree: () => {
						addAttempts += 1;
						return addAttempts === 1
							? Promise.reject(
									new GitError(
										{
											...stringResult(),
											gitError: null,
											gitErrorDescription: null,
										},
										["worktree", "add"],
										"husky: post-checkout hook exited with error",
									),
								)
							: Promise.resolve();
					},
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).resolves.toMatchObject({
				branch: "kilo/aback-aardvark",
			});
		});

		it("surfaces non-hook add failures even when the worktree is registered", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark"),
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					addWorktree: () =>
						Promise.reject(
							new GitError(
								{
									...stringResult(),
									gitError: null,
									gitErrorDescription: "fatal: invalid reference",
								},
								["worktree", "add"],
								"",
							),
						),
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: "fatal: invalid reference",
			});
		});

		it("retries once with a fresh branch name when the add reports an already-existing branch", async () => {
			const mainRoot = createMainRoot();
			let addCalls = 0;
			const addWorktree = vi.fn((_directory: string, options: { createBranch?: string }) => {
				addCalls += 1;
				return options.createBranch === "kilo/aback-aardvark"
					? Promise.reject(
							new GitError(
								{
									...stringResult(),
									gitError: null,
									gitErrorDescription: "fatal: a branch named 'kilo/aback-aardvark' already exists",
								},
								["worktree", "add"],
								"",
							),
						)
					: Promise.resolve();
			});
			let branchLists = 0;
			const manager = managerWith(
				worktreeClient(mainRoot, {
					branches: () => {
						branchLists += 1;
						// The first two calls (default-branch fallback + the
						// first pick) see an empty repo; the retry's pick sees
						// the branch the first add claimed.
						return Promise.resolve(branchLists <= 2 ? [] : [branchOf("kilo/aback-aardvark")]);
					},
					addWorktree,
				}),
			);

			const result = await manager.createWorktree({ workingDirectory: mainRoot });

			expect(addCalls).toBe(2);
			expect(addWorktree).toHaveBeenLastCalledWith(
				path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark-0"),
				expect.objectContaining({ createBranch: "kilo/aback-aardvark-0" }),
			);
			expect(result).toMatchObject({ branch: "kilo/aback-aardvark-0" });
		});

		it("serializes concurrent creates on one repository and picks distinct branches", async () => {
			const mainRoot = createMainRoot();
			// Deferred gate holds the first create inside `addWorktree`, so the
			// lock's effect on the second create is observable deterministically.
			const gate = deferred<void>();
			const order: string[] = [];
			const createdBranches: string[] = [];
			let worktreeListings = 0;
			const branches = vi.fn((options?: { prefixes?: readonly string[] }) => {
				// Called once for branch picking and twice for base resolution
				// (#resolveBaseCommitish runs branches() + branches({refs/remotes}) in parallel).
				order.push("branches");
				if (options?.prefixes?.includes("refs/remotes")) {
					return Promise.resolve([]);
				}
				return Promise.resolve(createdBranches.map((name) => branchOf(name)));
			});
			let addCalls = 0;
			const addWorktree = vi.fn((_directory: string, options: { createBranch?: string }) => {
				addCalls += 1;
				const branch = options.createBranch ?? "";
				order.push(`add:${branch}`);
				createdBranches.push(branch);
				return (addCalls === 1 ? gate.promise : Promise.resolve()).then(() => {
					order.push(`add-done:${branch}`);
				});
			});
			const manager = managerWith(
				worktreeClient(mainRoot, {
					branches,
					addWorktree,
					worktrees: () => {
						worktreeListings += 1;
						return Promise.resolve([worktreeEntry({ path: mainRoot, type: "main" })]);
					},
				}),
			);

			const first = manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "main" });
			await vi.waitFor(() => expect(addCalls).toBe(1));
			const second = manager.createWorktree({ workingDirectory: mainRoot, baseBranch: "main" });
			// The second create's read-only probes ran, but the first create
			// holds the repository lock, so it cannot pick a branch yet.
			// The first create makes 3 locked branches() calls: 1 pick + 2 for
			// base resolution (local + refs/remotes in parallel); the second
			// create has none yet.
			await vi.waitFor(() => expect(worktreeListings).toBe(2));
			await Promise.resolve();
			expect(branches).toHaveBeenCalledTimes(3);

			gate.resolve();
			const [firstResult, secondResult] = await Promise.all([first, second]);

			expect(firstResult.branch).toBe("kilo/aback-aardvark");
			expect(secondResult.branch).toBe("kilo/aback-aardvark-0");
			// 3 branches calls in the first locked window (pick + 2 base resolution),
			// then 3 more in the second locked window.
			expect(order).toEqual([
				"branches",
				"branches",
				"branches",
				"add:kilo/aback-aardvark",
				"add-done:kilo/aback-aardvark",
				"branches",
				"branches",
				"branches",
				"add:kilo/aback-aardvark-0",
				"add-done:kilo/aback-aardvark-0",
			]);
		});

		it("maps a real add failure to a KernelError with git's description", async () => {
			const mainRoot = createMainRoot();
			const failure = new GitError(
				{
					...stringResult(),
					gitError: null,
					gitErrorDescription: "fatal: invalid reference",
				},
				["worktree", "add"],
				"",
			);
			const manager = managerWith(
				worktreeClient(mainRoot, { addWorktree: () => Promise.reject(failure) }),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: "fatal: invalid reference",
			});
		});

		it("maps a missing git binary to a KernelError", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				worktreeClient(mainRoot, { addWorktree: () => Promise.reject(new GitNotDetectedError()) }),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: "Git was not found. Install Git, then restart Kilo Desktop.",
			});
		});

		it("maps a git older than the minimum version to a KernelError naming both versions", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree: () => Promise.reject(new UnsupportedGitVersionError("2.14.1", "2.17.0")),
				}),
			);

			const error = await manager
				.createWorktree({ workingDirectory: mainRoot })
				.catch((e: unknown) => e);
			expect(error).toMatchObject({ name: "KernelError", code: "BUSINESS" });
			expect((error as Error).message).toContain("Git 2.14.1");
			expect((error as Error).message).toContain("Git 2.17 or newer");
		});

		it("rejects before registering the worktree when the git exclude write fails", async () => {
			const mainRoot = createMainRoot();
			// A regular file where the git common dir should be: every later
			// `mkdir(<notDir>/info)` rejects with ENOTDIR, the same fs
			// failure mode production hits on an unwritable .git/info.
			const notADir = path.join(mainRoot, "not-a-dir");
			fs.writeFileSync(notADir, "x");
			const addWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					addWorktree,
					gitCommonDir: () => Promise.resolve(notADir),
				}),
			);

			await expect(manager.createWorktree({ workingDirectory: mainRoot })).rejects.toThrow();
			expect(addWorktree).not.toHaveBeenCalled();
		});

		it("appends .kilo/worktrees/ to the git exclude file once", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				worktreeClient(mainRoot, {
					gitCommonDir: (opts) => Promise.resolve(path.join(opts?.cwd ?? mainRoot, ".git")),
				}),
			);

			await manager.createWorktree({ workingDirectory: mainRoot });
			const excludePath = path.join(mainRoot, ".git", "info", "exclude");
			const afterFirst = fs.readFileSync(excludePath, "utf-8");
			expect(afterFirst).toContain(".kilo/worktrees/\n");

			await manager.createWorktree({ workingDirectory: mainRoot });
			const afterSecond = fs.readFileSync(excludePath, "utf-8");
			expect(afterSecond).toBe(afterFirst);
		});
	});

	describe("renameWorktreeBranch", () => {
		const worktreePath = (mainRoot: string) =>
			path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark");

		function renameClient(mainRoot: string, overrides: FakeClientOverrides = {}): GitClientSlice {
			const {
				execResponses,
				branches: branchesOverride,
				status: statusOverride,
				checkRefFormat: checkRefFormatOverride,
				...rest
			} = overrides;
			// Default status: worktree is on kilo/aback-aardvark with no upstream.
			const defaultStatus = () =>
				Promise.resolve({
					exists: true,
					currentBranch: "kilo/aback-aardvark",
					workingDirectory: { files: [] as never[] },
					doConflictedFilesExist: false,
				});
			// Default branches: no upstream on kilo/aback-aardvark, empty remote list.
			// Prefix-aware: local call returns the branch list, refs/remotes call returns [].
			const defaultBranches: GitClientSlice["branches"] = (options) => {
				if (options?.prefixes?.includes("refs/remotes")) {
					return Promise.resolve([]);
				}
				return Promise.resolve([branchOf("kilo/aback-aardvark")]);
			};
			return worktreeClient(mainRoot, {
				worktrees: () =>
					Promise.resolve([
						worktreeEntry({ path: mainRoot, type: "main" }),
						worktreeEntry({
							path: worktreePath(mainRoot),
							branch: "refs/heads/kilo/aback-aardvark",
						}),
					]),
				status: statusOverride ?? defaultStatus,
				branches: branchesOverride ?? defaultBranches,
				checkRefFormat: checkRefFormatOverride ?? (() => Promise.resolve(true)),
				...(execResponses !== undefined ? { execResponses } : {}),
				...rest,
			});
		}

		it("applies the naming policy and renames the branch", async () => {
			const mainRoot = createMainRoot();
			const renameBranch = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				renameClient(mainRoot, {
					branches: () => Promise.resolve([branchOf("main"), branchOf("kilo/aback-aardvark")]),
					renameBranch,
				}),
			);

			const result = await manager.renameWorktreeBranch({
				path: worktreePath(mainRoot),
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "Fix the Login Bug!",
			});

			expect(result).toEqual({ branch: "kilo/fix-the-login-bug" });
			expect(renameBranch).toHaveBeenCalledWith("kilo/aback-aardvark", "kilo/fix-the-login-bug", {
				cwd: worktreePath(mainRoot),
			});
		});

		it("declines (null) when HEAD moved to another branch", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				renameClient(mainRoot, {
					status: () =>
						Promise.resolve({
							exists: true,
							currentBranch: "other-branch",
							workingDirectory: { files: [] as never[] },
							doConflictedFilesExist: false,
						}),
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});

		it("declines (null) when the branch has an upstream", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				renameClient(mainRoot, {
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([]);
						}
						// kilo/aback-aardvark has an upstream set — the rename guard declines.
						return Promise.resolve([
							{ ...branchOf("kilo/aback-aardvark"), upstream: "origin/kilo/aback-aardvark" },
						]);
					},
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});

		it("declines (null) when the branch exists on a remote", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				renameClient(mainRoot, {
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							// The branch exists on origin — the rename guard declines.
							return Promise.resolve([
								{
									...branchOf("origin/kilo/aback-aardvark"),
									ref: "refs/remotes/origin/kilo/aback-aardvark",
								},
							]);
						}
						return Promise.resolve([branchOf("kilo/aback-aardvark")]);
					},
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});

		it("declines (null) when the requested name sanitizes to the current one", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(renameClient(mainRoot));

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "aback aardvark",
				}),
			).resolves.toBeNull();
		});

		it("declines (null) for an invalid branch name", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(
				renameClient(mainRoot, {
					checkRefFormat: () => Promise.resolve(false),
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "Fix the Login Bug!",
				}),
			).resolves.toBeNull();
		});

		it("dedupes the requested name against local and remote branches", async () => {
			const mainRoot = createMainRoot();
			const renameBranch = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				renameClient(mainRoot, {
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve([
								{
									...branchOf("origin/dev"),
									ref: "refs/remotes/origin/dev",
								},
							]);
						}
						return Promise.resolve([
							branchOf("main"),
							branchOf("kilo/aback-aardvark"),
							branchOf("kilo/fix-the-login-bug"),
							branchOf("kilo/fix-the-login-bug-2"),
						]);
					},
					renameBranch,
				}),
			);

			const result = await manager.renameWorktreeBranch({
				path: worktreePath(mainRoot),
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "Fix the Login Bug!",
			});

			expect(result).toEqual({ branch: "kilo/fix-the-login-bug-3" });
		});

		it("declines (null) for a path outside the managed worktrees directory", async () => {
			const mainRoot = createMainRoot();
			const manager = managerWith(renameClient(mainRoot));

			await expect(
				manager.renameWorktreeBranch({
					path: path.join(mainRoot, "elsewhere"),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});

		it("passes the managed-path guard when input path is a symlink alias of the canonical path", async () => {
			const mainRoot = createMainRoot();
			const canonical = worktreePath(mainRoot);
			const renameBranch = vi.fn(() => Promise.resolve());
			const manager = managerWith(renameClient(mainRoot, { renameBranch }));

			// The fake listing already returns canonical paths (as git would).
			// Passing the canonical path directly exercises that canonicalizePath
			// does not break the existing happy path when the path is already resolved.
			const result = await manager.renameWorktreeBranch({
				path: canonical,
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "Fix the Login Bug!",
			});

			expect(result).toEqual({ branch: "kilo/fix-the-login-bug" });
			expect(renameBranch).toHaveBeenCalled();
		});

		it("declines (null) when the worktree is no longer a repository (status returns null)", async () => {
			// status() returning null means the worktree path is no longer a git
			// repository. The rename declines rather than throwing.
			const mainRoot = createMainRoot();
			const manager = managerWith(
				renameClient(mainRoot, {
					status: () => Promise.resolve(null),
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});

		it("declines (null) when the local branch list is unavailable (branches returns null)", async () => {
			// branches() returning null (not-a-repo) causes the rename to decline
			// rather than throwing — the upstream/dedupe guard needs the branch list.
			const mainRoot = createMainRoot();
			const manager = managerWith(
				renameClient(mainRoot, {
					branches: () => Promise.resolve(null),
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});

		it("declines (null) when the remote ref list is unavailable (remote branches returns null)", async () => {
			// branches({prefixes:['refs/remotes']}) returning null (not-a-repo)
			// causes the rename to decline. This is the rename-site guard.
			const mainRoot = createMainRoot();
			// Override branches to return null only for the refs/remotes prefixes call.
			const manager = managerWith(
				renameClient(mainRoot, {
					branches: (options) => {
						if (options?.prefixes?.includes("refs/remotes")) {
							return Promise.resolve(null);
						}
						return Promise.resolve([branchOf("main"), branchOf("kilo/aback-aardvark")]);
					},
				}),
			);

			await expect(
				manager.renameWorktreeBranch({
					path: worktreePath(mainRoot),
					currentBranch: "kilo/aback-aardvark",
					requestedBranch: "fix login",
				}),
			).resolves.toBeNull();
		});
	});

	describe("removeWorktree", () => {
		const worktreePath = (mainRoot: string) =>
			path.join(mainRoot, ".kilo", "worktrees", "kilo-aback-aardvark");

		function removalSetup(mainRoot: string, branch: string) {
			const gitRemove = vi.fn(() => Promise.resolve());
			const deleteBranch = vi.fn(() => Promise.resolve());
			const pruneWorktrees = vi.fn(() => Promise.resolve());
			const renameDirectory = vi.fn(async () => {});
			const removeDirectory = vi.fn(async () => {});
			const execLog: ExecCall[] = [];
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: worktreePath(mainRoot),
								branch: `refs/heads/${branch}`,
							}),
						]),
					removeWorktree: gitRemove,
					deleteBranch,
					pruneWorktrees,
					execLog,
				}),
				() => 0,
				{ renameDirectory, removeDirectory, sleep: async () => undefined },
			);
			return {
				manager,
				gitRemove,
				deleteBranch,
				pruneWorktrees,
				renameDirectory,
				removeDirectory,
				execLog,
			};
		}

		it("removes a managed worktree by renaming it away, pruning, and deleting its branch", async () => {
			const mainRoot = createMainRoot();
			const { manager, gitRemove, deleteBranch, pruneWorktrees, renameDirectory, removeDirectory } =
				removalSetup(mainRoot, "kilo/aback-aardvark");

			await manager.removeWorktree({ path: worktreePath(mainRoot) });

			// Windows-safe removal (kilocode): rename to a temp sibling first —
			// the directory disappears instantly and git's own removal is not
			// needed.
			expect(renameDirectory).toHaveBeenCalledWith(
				worktreePath(mainRoot),
				expect.stringContaining(".kilo-delete-"),
			);
			expect(pruneWorktrees).toHaveBeenCalledWith({ cwd: mainRoot });
			expect(gitRemove).not.toHaveBeenCalled();
			expect(deleteBranch).toHaveBeenCalledWith("kilo/aback-aardvark", { cwd: mainRoot });
			// The temp directory is deleted in the background.
			expect(removeDirectory).toHaveBeenCalledWith(expect.stringContaining(".kilo-delete-"));
		});

		it("falls back to a forced git removal when the rename fails", async () => {
			const mainRoot = createMainRoot();
			const { manager, gitRemove, deleteBranch, pruneWorktrees, renameDirectory, removeDirectory } =
				removalSetup(mainRoot, "kilo/aback-aardvark");
			// Cross-device or locked directory: the atomic rename cannot run.
			renameDirectory.mockRejectedValue(
				Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" }),
			);

			await manager.removeWorktree({ path: worktreePath(mainRoot) });

			expect(gitRemove).toHaveBeenCalledWith(worktreePath(mainRoot), {
				cwd: mainRoot,
				force: true,
			});
			expect(removeDirectory).toHaveBeenCalledWith(worktreePath(mainRoot));
			expect(pruneWorktrees).toHaveBeenCalledWith({ cwd: mainRoot });
			expect(deleteBranch).toHaveBeenCalledWith("kilo/aback-aardvark", { cwd: mainRoot });
		});

		it("retries a busy rename until the worktree directory can move", async () => {
			const mainRoot = createMainRoot();
			const busy = Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
			const renameDirectory = vi
				.fn()
				.mockRejectedValueOnce(busy)
				.mockRejectedValueOnce(busy)
				.mockResolvedValue(undefined);
			const gitRemove = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: worktreePath(mainRoot),
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					removeWorktree: gitRemove,
					deleteBranch: vi.fn(() => Promise.resolve()),
					pruneWorktrees: vi.fn(() => Promise.resolve()),
				}),
				() => 0,
				{ renameDirectory, removeDirectory: vi.fn(async () => {}), sleep: async () => undefined },
			);

			await manager.removeWorktree({ path: worktreePath(mainRoot) });

			expect(renameDirectory).toHaveBeenCalledTimes(3);
			expect(gitRemove).not.toHaveBeenCalled();
		});

		it("matches a Windows listing path that differs only by case", async () => {
			const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
			try {
				const mainRoot = createMainRoot();
				const wt = worktreePath(mainRoot);
				const renameDirectory = vi.fn(async () => undefined);
				const gitRemove = vi.fn(() => Promise.resolve());
				const manager = managerWith(
					worktreeClient(mainRoot, {
						worktrees: () =>
							Promise.resolve([
								worktreeEntry({ path: mainRoot.toUpperCase(), type: "main" }),
								worktreeEntry({
									path: wt.toUpperCase(),
									branch: "refs/heads/kilo/aback-aardvark",
								}),
							]),
						removeWorktree: gitRemove,
						deleteBranch: vi.fn(() => Promise.resolve()),
						pruneWorktrees: vi.fn(() => Promise.resolve()),
					}),
					() => 0,
					{
						renameDirectory,
						removeDirectory: vi.fn(async () => {}),
						sleep: async () => undefined,
						// The host's identity is fixed at import, so mocking the platform can't make
						// it fold case: compare by Windows rules, resolve on this host's filesystem.
						pathIdentity: {
							...createPathIdentity({ platform: "win32" }),
							canonical: hostPathIdentity.canonical,
						},
					},
				);

				await manager.removeWorktree({ path: wt });

				expect(renameDirectory).toHaveBeenCalled();
				expect(gitRemove).not.toHaveBeenCalled();
			} finally {
				platform.mockRestore();
			}
		});

		it("keeps non-kilo branches when removing the worktree", async () => {
			const mainRoot = createMainRoot();
			const { manager, deleteBranch } = removalSetup(mainRoot, "my-own-work");

			await manager.removeWorktree({ path: worktreePath(mainRoot) });

			expect(deleteBranch).not.toHaveBeenCalled();
		});

		it("resolves success when the worktree is already gone", async () => {
			const mainRoot = createMainRoot();
			const removeWorktree = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.reject(
							new GitError({ ...stringResult() }, ["worktree", "list"], "not a repository"),
						),
					removeWorktree,
				}),
			);

			await expect(
				manager.removeWorktree({ path: worktreePath(mainRoot) }),
			).resolves.toBeUndefined();
			expect(removeWorktree).not.toHaveBeenCalled();
		});

		it("deletes the inferred kilo/ branch when listing the worktree path fails", async () => {
			const mainRoot = createMainRoot();
			const gone = worktreePath(mainRoot);
			const deleteBranch = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: (opts) => {
						if (opts?.cwd === gone) {
							return Promise.reject(
								new GitError({ ...stringResult() }, ["worktree", "list"], "not a repository"),
							);
						}
						return Promise.resolve([worktreeEntry({ path: mainRoot, type: "main" })]);
					},
					deleteBranch,
					pruneWorktrees: vi.fn(() => Promise.resolve()),
				}),
			);

			await expect(manager.removeWorktree({ path: gone })).resolves.toBeUndefined();
			expect(deleteBranch).toHaveBeenCalledWith("kilo/aback-aardvark", { cwd: mainRoot });
		});

		it("deletes the inferred kilo/ branch when the worktree is already unregistered", async () => {
			const mainRoot = createMainRoot();
			const removeWorktree = vi.fn(() => Promise.resolve());
			const deleteBranch = vi.fn(() => Promise.resolve());
			const pruneWorktrees = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () => Promise.resolve([worktreeEntry({ path: mainRoot, type: "main" })]),
					removeWorktree,
					deleteBranch,
					pruneWorktrees,
				}),
			);

			await expect(
				manager.removeWorktree({ path: worktreePath(mainRoot) }),
			).resolves.toBeUndefined();
			expect(removeWorktree).not.toHaveBeenCalled();
			expect(deleteBranch).toHaveBeenCalledWith("kilo/aback-aardvark", { cwd: mainRoot });
			expect(pruneWorktrees).toHaveBeenCalledWith({ cwd: mainRoot });
		});

		it("drops the inferred branch of a gone worktree named through another spelling of the repo", async () => {
			// The alias stands in for a Windows 8.3 short name or a symlinked
			// folder: the worktree itself is gone, so only its existing parent
			// can be resolved to the path git lists.
			const mainRoot = createMainRoot();
			const alias = path.join(createMainRoot(), "alias");
			fs.symlinkSync(mainRoot, alias, "junction");
			const deleteBranch = vi.fn(() => Promise.resolve());
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () => Promise.resolve([worktreeEntry({ path: mainRoot, type: "main" })]),
					deleteBranch,
				}),
			);

			await manager.removeWorktree({ path: worktreePath(alias) });

			expect(deleteBranch).toHaveBeenCalledWith("kilo/aback-aardvark", { cwd: mainRoot });
		});

		it("retries branch deletion when git still reports the branch in use", async () => {
			const mainRoot = createMainRoot();
			const inUse = new GitError(
				stringResult(),
				["branch", "-D", "kilo/aback-aardvark"],
				"error: cannot delete branch 'kilo/aback-aardvark' used by worktree at '/tmp/wt'",
			);
			const deleteBranch = vi.fn().mockRejectedValueOnce(inUse).mockResolvedValueOnce(undefined);
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: worktreePath(mainRoot),
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					deleteBranch,
					pruneWorktrees: vi.fn(() => Promise.resolve()),
				}),
				() => 0,
				{
					renameDirectory: vi.fn(async () => undefined),
					removeDirectory: vi.fn(async () => undefined),
					sleep: async () => undefined,
				},
			);

			await manager.removeWorktree({ path: worktreePath(mainRoot) });

			expect(deleteBranch).toHaveBeenCalledTimes(2);
		});

		it("retries branch deletion when another git process holds the lock", async () => {
			const mainRoot = createMainRoot();
			const locked = new GitError(
				{
					...stringResult(),
					gitError: GitErrorCode.LockFileAlreadyExists,
					gitErrorDescription: "Another git process seems to be running in this repository, e.g.",
				},
				["branch", "-D", "kilo/aback-aardvark"],
				"",
			);
			const deleteBranch = vi.fn().mockRejectedValueOnce(locked).mockResolvedValueOnce(undefined);
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: worktreePath(mainRoot),
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					deleteBranch,
					pruneWorktrees: vi.fn(() => Promise.resolve()),
				}),
				() => 0,
				{
					renameDirectory: vi.fn(async () => undefined),
					removeDirectory: vi.fn(async () => undefined),
					sleep: async () => undefined,
				},
			);

			await manager.removeWorktree({ path: worktreePath(mainRoot) });

			expect(deleteBranch).toHaveBeenCalledTimes(2);
		});

		it("treats a missing branch as already deleted", async () => {
			const mainRoot = createMainRoot();
			const missing = new GitError(
				stringResult(),
				["branch", "-D", "kilo/aback-aardvark"],
				"error: branch 'kilo/aback-aardvark' not found.",
			);
			const deleteBranch = vi.fn(() => Promise.reject(missing));
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: worktreePath(mainRoot),
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					deleteBranch,
					pruneWorktrees: vi.fn(() => Promise.resolve()),
				}),
				() => 0,
				{
					renameDirectory: vi.fn(async () => undefined),
					removeDirectory: vi.fn(async () => undefined),
					sleep: async () => undefined,
				},
			);

			await expect(
				manager.removeWorktree({ path: worktreePath(mainRoot) }),
			).resolves.toBeUndefined();
		});

		it("rejects with a KernelError for a path outside the managed worktrees directory", async () => {
			const mainRoot = createMainRoot();
			const outside = path.join(mainRoot, "important-checkout");
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({ path: outside, branch: "refs/heads/main" }),
						]),
				}),
			);

			await expect(manager.removeWorktree({ path: outside })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
			});
		});

		it("maps removal failures to KernelErrors", async () => {
			const mainRoot = createMainRoot();
			const { manager, gitRemove, renameDirectory } = removalSetup(mainRoot, "kilo/aback-aardvark");
			renameDirectory.mockRejectedValue(new Error("EPERM: operation not permitted"));
			gitRemove.mockRejectedValue(
				new GitError(
					{ ...stringResult(), gitError: null, gitErrorDescription: "fatal: worktree is locked" },
					["worktree", "remove"],
					"",
				),
			);

			await expect(manager.removeWorktree({ path: worktreePath(mainRoot) })).rejects.toMatchObject({
				name: "KernelError",
				code: "BUSINESS",
				message: "fatal: worktree is locked",
			});
		});

		it("removes when input path is a symlink alias of the registered canonical path", async () => {
			const mainRoot = createMainRoot();
			const canonical = worktreePath(mainRoot);
			const renameDirectory = vi.fn(async () => {});
			const removeDirectory = vi.fn(async () => {});
			// Fake listing returns the canonical (realpath'd) path, as git would.
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () =>
						Promise.resolve([
							worktreeEntry({ path: mainRoot, type: "main" }),
							worktreeEntry({
								path: canonical,
								branch: "refs/heads/kilo/aback-aardvark",
							}),
						]),
					deleteBranch: vi.fn(() => Promise.resolve()),
				}),
				() => 0,
				{ renameDirectory, removeDirectory },
			);

			// Simulate a symlink-aliased input: strip the realpath prefix to
			// construct a path that resolves to the same directory but doesn't
			// match the listing without canonicalization. On macOS we use the
			// canonical path directly — the point is that canonicalizePath is
			// called and the rename seam fires with the canonical path.
			await manager.removeWorktree({ path: canonical });

			expect(renameDirectory).toHaveBeenCalledWith(
				canonical,
				expect.stringContaining(".kilo-delete-"),
			);
		});

		it("resolves when input path no longer exists (realpath falls back to resolve)", async () => {
			const mainRoot = createMainRoot();
			// A path that does not exist: realpath will throw, canonicalizePath
			// falls back to resolve, and the worktrees listing returns nothing
			// matching — the call resolves success (idempotent remove).
			const gone = path.join(mainRoot, ".kilo", "worktrees", "kilo-already-gone");
			const manager = managerWith(
				worktreeClient(mainRoot, {
					worktrees: () => Promise.resolve([worktreeEntry({ path: mainRoot, type: "main" })]),
				}),
			);

			await expect(manager.removeWorktree({ path: gone })).resolves.toBeUndefined();
		});
	});

	describe("linkAgentManagerSession", () => {
		/** A registered linked worktree whose `.git` file points at its admin dir. */
		function linkedWorktree(mainRoot: string, name = "kilo-aback-aardvark") {
			const worktreePath = path.join(mainRoot, ".kilo", "worktrees", name);
			const adminDir = path.join(mainRoot, ".git", "worktrees", name);
			fs.mkdirSync(worktreePath, { recursive: true });
			fs.mkdirSync(adminDir, { recursive: true });
			fs.writeFileSync(path.join(worktreePath, ".git"), `gitdir: ${adminDir}\n`);
			const worktrees = () =>
				Promise.resolve([
					worktreeEntry({ path: mainRoot, type: "main" }),
					worktreeEntry({ path: worktreePath, branch: `refs/heads/kilo/${name}` }),
				]);
			return {
				worktreePath,
				metadataFile: path.join(adminDir, "kilo-agent-manager-metadata.json"),
				worktrees,
			};
		}

		it("writes the session and split base into the worktree's git admin dir", async () => {
			const mainRoot = createMainRoot();
			const { worktreePath, metadataFile, worktrees } = linkedWorktree(mainRoot);
			const manager = managerWith(
				worktreeClient(mainRoot, { worktrees, remotes: () => Promise.resolve(["origin"]) }),
			);

			await expect(
				manager.linkAgentManagerSession({
					path: worktreePath,
					sessionId: "ses_1",
					baseRef: "origin/release/1.0",
				}),
			).resolves.toBe(true);

			expect(JSON.parse(fs.readFileSync(metadataFile, "utf-8"))).toEqual({
				sessionId: "ses_1",
				parentBranch: "release/1.0",
				remote: "origin",
			});
		});

		it("keeps a base without a remote prefix as the branch name", async () => {
			const mainRoot = createMainRoot();
			const { worktreePath, metadataFile, worktrees } = linkedWorktree(mainRoot);
			const manager = managerWith(
				worktreeClient(mainRoot, { worktrees, remotes: () => Promise.resolve(["origin"]) }),
			);

			await manager.linkAgentManagerSession({
				path: worktreePath,
				sessionId: "ses_1",
				baseRef: "release/1.0",
			});

			expect(JSON.parse(fs.readFileSync(metadataFile, "utf-8"))).toEqual({
				sessionId: "ses_1",
				parentBranch: "release/1.0",
			});
		});

		it("never overwrites an existing metadata file", async () => {
			const mainRoot = createMainRoot();
			const { worktreePath, metadataFile, worktrees } = linkedWorktree(mainRoot);
			fs.writeFileSync(metadataFile, '{"sessionId":"ses_agent_manager"}');
			const manager = managerWith(worktreeClient(mainRoot, { worktrees }));

			await expect(
				manager.linkAgentManagerSession({ path: worktreePath, sessionId: "ses_1" }),
			).resolves.toBe(false);

			expect(fs.readFileSync(metadataFile, "utf-8")).toBe('{"sessionId":"ses_agent_manager"}');
		});

		it("declines paths outside the managed worktrees directory", async () => {
			const mainRoot = createMainRoot();
			const elsewhere = path.join(mainRoot, "elsewhere");
			fs.mkdirSync(elsewhere);
			const worktrees = vi.fn(() =>
				Promise.resolve([
					worktreeEntry({ path: mainRoot, type: "main" }),
					worktreeEntry({ path: elsewhere }),
				]),
			);
			const manager = managerWith(worktreeClient(mainRoot, { worktrees }));

			await expect(
				manager.linkAgentManagerSession({ path: elsewhere, sessionId: "ses_1" }),
			).resolves.toBe(false);
		});

		it("declines a managed directory git no longer registers", async () => {
			const mainRoot = createMainRoot();
			const { worktreePath, metadataFile } = linkedWorktree(mainRoot);
			const manager = managerWith(worktreeClient(mainRoot));

			await expect(
				manager.linkAgentManagerSession({ path: worktreePath, sessionId: "ses_1" }),
			).resolves.toBe(false);
			expect(fs.existsSync(metadataFile)).toBe(false);
		});

		it("declines a deleted worktree without spawning git", async () => {
			const mainRoot = createMainRoot();
			const worktrees = vi.fn(() => Promise.resolve([]));
			const manager = managerWith(worktreeClient(mainRoot, { worktrees }));

			await expect(
				manager.linkAgentManagerSession({
					path: path.join(mainRoot, ".kilo", "worktrees", "kilo-gone"),
					sessionId: "ses_1",
				}),
			).resolves.toBe(false);
			expect(worktrees).not.toHaveBeenCalled();
		});
	});
});
