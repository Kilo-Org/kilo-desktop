import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FeatureError, type MainSdkLogger } from "@kilo-desktop/feature-sdk";
import {
	AppFileStatusKind,
	GitFileTooLargeError,
	GitNotDetectedError,
} from "@kilo-desktop/git-client";
import type { IStatusResult, RepositoryType } from "@kilo-desktop/git-client";

import { GitService, type GitClientSlice } from "./git-service.js";
import { WorktreeManager } from "./worktree-manager.js";

const logger: MainSdkLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/**
 * Fills any missing slice member with a harmless default so tests only spell
 * out the calls they assert on.
 */
function clientOf(client: Partial<GitClientSlice>): GitClientSlice {
	return {
		status: () => Promise.reject(new Error("unused")),
		version: () => Promise.resolve("2.39.5"),
		branches: () => Promise.resolve(null),
		createBranch: () => Promise.resolve(),
		checkoutBranch: () => Promise.resolve(),
		repositoryType: () => Promise.resolve({ kind: "missing" }),
		initRepository: () => Promise.resolve(),
		createWorkingDirectoryPatch: () => Promise.resolve(null),
		getFileContents: () => Promise.resolve({ oldContents: null, newContents: null }),
		remoteHead: () => Promise.resolve(null),
		globalConfigValue: () => Promise.resolve(null),
		recentBranches: () => Promise.resolve([]),
		worktrees: () => Promise.resolve([]),
		addWorktree: () => Promise.resolve(),
		removeWorktree: () => Promise.resolve(),
		deleteBranch: () => Promise.resolve(),
		renameBranch: () => Promise.resolve(),
		defaultBranch: () => Promise.resolve(null),
		remotes: () => Promise.resolve([]),
		pruneWorktrees: () => Promise.resolve(),
		checkRefFormat: () => Promise.resolve(true),
		gitCommonDir: () => Promise.resolve("/repo/.git"),
		exec: (() => Promise.resolve(null)) as unknown as GitClientSlice["exec"],
		...client,
	};
}

/** A status result with the given current branch and a clean tree. */
function statusOn(currentBranch: string) {
	return () =>
		Promise.resolve({
			exists: true,
			currentBranch,
			workingDirectory: { files: [] },
			doConflictedFilesExist: false,
		});
}

function localBranch(name: string, upstream: string | null = null) {
	return {
		name,
		upstream,
		tip: { sha: "abc123" },
		ref: `refs/heads/${name}`,
	};
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

/** A real file in a real temp directory, so release/dispose removals are observable. */
async function writeFileToTemp(prefix: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	const filePath = join(directory, "changes.patch");
	await writeFile(filePath, "x");
	return filePath;
}

/** Folder provider whose workspaces contain exactly the given folder paths. */
function folders(...paths: string[]): () => Promise<readonly string[]> {
	return () => Promise.resolve(paths);
}

/** Folder provider whose workspaces capability is absent (kilo-ui missing). */
function absentFolders(): () => Promise<readonly string[] | null> {
	return () => Promise.resolve(null);
}

describe("GitService", () => {
	it("rejects option-like push branches before invoking git", async () => {
		const exec = vi.fn();
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/some/repo"),
			createClient: () => clientOf({ exec }),
		});

		await expect(service.push("/some/repo", "--force", false)).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		expect(exec).not.toHaveBeenCalled();
	});

	it("rejects option-like pull request base branches before invoking git", async () => {
		const exec = vi.fn();
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/some/repo"),
			createClient: () => clientOf({ exec }),
		});

		await expect(
			service.pullRequestContext("/some/repo", "--output=/tmp/exfiltrate"),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });
		expect(exec).not.toHaveBeenCalled();
	});

	it("rejects with a BUSINESS FeatureError when the git binary is not found", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new GitNotDetectedError()),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.status("/some/repo")).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
		});
	});

	it("lets other errors propagate unwrapped", async () => {
		const failure = new Error("fatal: unexpected git failure");
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/some/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(failure),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.status("/some/repo")).rejects.toBe(failure);
	});

	it("runs status in the given working directory and passes the result through", async () => {
		const clientResult: IStatusResult = {
			exists: true,
			currentBranch: "main",
			workingDirectory: {
				files: [{ path: "notes.txt", status: { kind: AppFileStatusKind.Untracked } }],
			},
			doConflictedFilesExist: false,
		};
		const status = vi.fn(() => Promise.resolve(clientResult));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () => clientOf({ status, version: () => Promise.resolve("2.39.5") }),
		});

		const result = await service.status("/repos/project");

		expect(status).toHaveBeenCalledWith({ cwd: "/repos/project" });
		expect(result).toEqual({
			exists: true,
			currentBranch: "main",
			workingDirectory: {
				files: [{ path: "notes.txt", status: { kind: AppFileStatusKind.Untracked } }],
			},
			doConflictedFilesExist: false,
		});
	});

	it("passes null through when the directory is not a repository", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/not/a/repo"),
			createClient: () =>
				clientOf({
					status: () => Promise.resolve(null),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.status("/not/a/repo")).resolves.toBe(null);
	});

	describe("branches", () => {
		it("lists remotes that no local branch tracks and tags each kind", async () => {
			const branches = vi.fn(() =>
				Promise.resolve([
					{
						name: "main",
						upstream: "origin/main",
						tip: { sha: "aaa" },
						ref: "refs/heads/main",
					},
					{
						name: "origin/main",
						upstream: null,
						tip: { sha: "aaa" },
						ref: "refs/remotes/origin/main",
					},
					{
						name: "origin/feature",
						upstream: null,
						tip: { sha: "bbb" },
						ref: "refs/remotes/origin/feature",
					},
				]),
			);
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: () =>
							Promise.resolve({
								exists: true,
								currentBranch: "main",
								workingDirectory: { files: [] },
								doConflictedFilesExist: false,
							}),
						branches,
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toEqual({
				currentBranch: "main",
				branches: [
					{
						name: "main",
						upstream: "origin/main",
						tip: { sha: "aaa" },
						ref: "refs/heads/main",
						kind: "local",
					},
					{
						name: "origin/feature",
						upstream: null,
						tip: { sha: "bbb" },
						ref: "refs/remotes/origin/feature",
						kind: "remote",
					},
				],
				defaultBranch: "main",
				recentBranches: [],
			});
			expect(branches).toHaveBeenCalledWith({
				cwd: "/repos/project",
				prefixes: ["refs/heads", "refs/remotes"],
			});
		});

		it("runs the default-branch and recent-branch probes alongside the branch probes", async () => {
			const remoteHead = vi.fn(() => Promise.resolve("main"));
			const globalConfigValue = vi.fn(() => Promise.resolve(null));
			const recentBranches = vi.fn(() => Promise.resolve([]));
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("main"),
						branches: () => Promise.resolve([localBranch("main", "origin/main")]),
						remoteHead,
						globalConfigValue,
						recentBranches,
					}),
			});

			await service.branches("/repos/project");

			expect(remoteHead).toHaveBeenCalledWith("origin", { cwd: "/repos/project" });
			expect(globalConfigValue).toHaveBeenCalledWith("init.defaultBranch");
			// One more than the recent limit: the default branch often appears in
			// the reflog and is filtered afterwards.
			expect(recentBranches).toHaveBeenCalledWith(6, { cwd: "/repos/project" });
		});

		it("reports the default branch resolved from the remote HEAD", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("develop"),
						branches: () =>
							Promise.resolve([
								localBranch("develop", "origin/main"),
								localBranch("main", "origin/main"),
							]),
						remoteHead: () => Promise.resolve("main"),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				defaultBranch: "main",
			});
		});

		it("falls back to the configured default branch without a remote HEAD", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("trunk"),
						branches: () => Promise.resolve([localBranch("trunk"), localBranch("main")]),
						globalConfigValue: () => Promise.resolve("trunk"),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				defaultBranch: "trunk",
			});
		});

		it("omits defaultBranch when no branch matches the detected name", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("feature"),
						branches: () => Promise.resolve([localBranch("feature")]),
						remoteHead: () => Promise.resolve("main"),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toEqual({
				currentBranch: "feature",
				branches: [
					{
						name: "feature",
						upstream: null,
						tip: { sha: "abc123" },
						ref: "refs/heads/feature",
						kind: "local",
					},
				],
				recentBranches: [],
			});
		});

		it("resolves recentBranches in reflog order, dropping the default and deleted branches", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("main"),
						branches: () =>
							Promise.resolve([
								localBranch("main"),
								localBranch("topic-b"),
								localBranch("topic-a"),
							]),
						recentBranches: () => Promise.resolve(["main", "topic-b", "deleted", "topic-a"]),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				recentBranches: ["topic-b", "topic-a"],
			});
		});

		it("caps recentBranches at five", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({
						status: statusOn("main"),
						branches: () =>
							Promise.resolve([
								localBranch("main"),
								localBranch("topic-1"),
								localBranch("topic-2"),
								localBranch("topic-3"),
								localBranch("topic-4"),
								localBranch("topic-5"),
							]),
						recentBranches: () =>
							Promise.resolve(["main", "topic-1", "topic-2", "topic-3", "topic-4", "topic-5"]),
					}),
			});

			await expect(service.branches("/repos/project")).resolves.toMatchObject({
				recentBranches: ["topic-1", "topic-2", "topic-3", "topic-4", "topic-5"],
			});
		});

		it("resolves null when either probe reports not a repository", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/not/a/repo"),
				createClient: () =>
					clientOf({
						status: () => Promise.resolve(null),
						branches: () =>
							Promise.resolve([
								{
									name: "main",
									upstream: null,
									tip: { sha: "abc123" },
									ref: "refs/heads/main",
								},
							]),
						createBranch: () => Promise.resolve(),
						checkoutBranch: () => Promise.resolve(),
						version: () => Promise.resolve("2.39.5"),
					}),
			});

			await expect(service.branches("/not/a/repo")).resolves.toBe(null);
		});
	});

	describe("repositoryType", () => {
		it("probes the given working directory and passes each kind through", async () => {
			const kinds: RepositoryType[] = [
				{ kind: "missing" },
				{ kind: "bare" },
				{ kind: "unsafe", path: "/some/repo" },
				{
					kind: "regular",
					topLevelWorkingDirectory: "/some/repo",
					gitDir: "/some/repo/.git",
				},
			];

			for (const repositoryType of kinds) {
				const repositoryTypeProbe = vi.fn(() => Promise.resolve(repositoryType));
				const service = new GitService({
					logger,
					getWorkspaceFolderPaths: folders("/some/repo"),
					createClient: () => clientOf({ repositoryType: repositoryTypeProbe }),
				});

				await expect(service.repositoryType("/some/repo")).resolves.toEqual(repositoryType);
				expect(repositoryTypeProbe).toHaveBeenCalledWith("/some/repo");
			}
		});
	});

	describe("init", () => {
		it("runs initRepository with the working directory as cwd", async () => {
			const initRepository = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/some/repo"),
				createClient: () => clientOf({ initRepository }),
			});

			await expect(service.init("/some/repo")).resolves.toBeUndefined();
			expect(initRepository).toHaveBeenCalledWith({ cwd: "/some/repo" });
		});

		it("rejects with VALIDATION when the directory is outside every workspace folder", async () => {
			const initRepository = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/workspaces/project"),
				createClient: () => clientOf({ initRepository }),
			});

			await expect(service.init("/elsewhere/other")).rejects.toMatchObject({
				name: "FeatureError",
				code: "VALIDATION",
			});
			expect(initRepository).not.toHaveBeenCalled();
		});

		it("fails closed with VALIDATION when the workspaces capability is absent", async () => {
			const initRepository = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: absentFolders(),
				createClient: () => clientOf({ initRepository }),
			});

			await expect(service.init("/workspaces/project")).rejects.toMatchObject({
				name: "FeatureError",
				code: "VALIDATION",
			});
			expect(initRepository).not.toHaveBeenCalled();
		});

		it("maps GitNotDetectedError to a BUSINESS FeatureError", async () => {
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () =>
					clientOf({ initRepository: () => Promise.reject(new GitNotDetectedError()) }),
			});

			await expect(service.init("/repos/project")).rejects.toMatchObject({
				name: "FeatureError",
				code: "BUSINESS",
			});
		});

		it("lets other errors propagate unwrapped", async () => {
			const failure = new Error("fatal: cannot init");
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/repos/project"),
				createClient: () => clientOf({ initRepository: () => Promise.reject(failure) }),
			});

			await expect(service.init("/repos/project")).rejects.toBe(failure);
		});
	});

	describe("checkout", () => {
		it("checks out a remote branch with tracking", async () => {
			const checkoutBranch = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/some/repo"),
				createClient: () => clientOf({ checkoutBranch }),
			});

			await service.checkout("/some/repo", "origin/feature", undefined, undefined, "remote");

			expect(checkoutBranch).toHaveBeenCalledWith("origin/feature", {
				cwd: "/some/repo",
				track: true,
			});
		});

		it("forwards the start point to createBranch when creating", async () => {
			const createBranch = vi.fn(() => Promise.resolve());
			const checkoutBranch = vi.fn(() => Promise.resolve());
			const service = new GitService({
				logger,
				getWorkspaceFolderPaths: folders("/some/repo"),
				createClient: () => clientOf({ createBranch, checkoutBranch }),
			});

			await service.checkout("/some/repo", "topic", true, "main");

			expect(createBranch).toHaveBeenCalledWith("topic", "main", { cwd: "/some/repo" });
			expect(checkoutBranch).toHaveBeenCalledWith("topic", { cwd: "/some/repo" });
		});
	});

	it("available resolves true when the git version is obtained", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					version: () => Promise.resolve("2.39.5"),
				}),
		});

		await expect(service.available()).resolves.toBe(true);
	});

	it("available resolves false when the git binary is not detected", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					version: () => {
						throw new GitNotDetectedError();
					},
				}),
		});

		await expect(service.available()).resolves.toBe(false);
	});

	it("available resolves false when the version probe fails with any other error", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					version: () => Promise.reject(new Error("failed to parse git version")),
				}),
		});

		await expect(service.available()).resolves.toBe(false);
	});

	it("available resolves false when the version probe resolves a falsey value", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders(),
			createClient: () =>
				clientOf({
					status: () => Promise.reject(new Error("unused")),
					// `version()` is declared `Promise<string>`, but the probe
					// treats a falsey resolved value as unavailable rather
					// than trusting the declared type across the seam, hence
					// the cast to violate the declared type deliberately.
					version: () => Promise.resolve(null as unknown as string),
				}),
		});

		await expect(service.available()).resolves.toBe(false);
	});
});

describe("GitService getDiffContents", () => {
	// Validation is exercised through the public getDiffContents surface with
	// a fake client, so the table covers both the accepts and the rejects.
	it.each([
		["README.md"],
		["src/index.ts"],
		// Legal in-tree names starting with `..` — a `startsWith("..")` check
		// would falsely reject these (the false positive this guards against).
		["..foo"],
		["..foo/bar.txt"],
		// Normalizes back in-tree before the escape check.
		["a/../b"],
		[".gitignore"],
	])("accepts the in-tree path %s", async (path) => {
		const getFileContents = vi.fn(() => Promise.resolve({ oldContents: null, newContents: null }));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () => clientOf({ getFileContents }),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path }),
		).resolves.toEqual({ oldContents: null, newContents: null });
		expect(getFileContents).toHaveBeenCalledWith(expect.objectContaining({ path }));
	});

	it.each([
		[".."],
		["../outside.txt"],
		["sub/../../outside.txt"],
		// Absolute paths are rejected even when they point inside the working
		// directory (the contract takes repo-relative paths only).
		["/etc/passwd"],
		// A Windows drive-absolute path only escapes on win32; on POSIX it is
		// a legal (if odd) relative directory name, so this case is asserted
		// only where it is an escape.
		...(process.platform === "win32" ? [["C:\\Windows\\system32"]] : []),
	])("rejects the escaping path %s without touching the client", async (path) => {
		const getFileContents = vi.fn(() => Promise.resolve({ oldContents: null, newContents: null }));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () => clientOf({ getFileContents }),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path }),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });
		await expect(
			service.getDiffContents({
				workingDirectory: "/repos/project",
				path: "ok.txt",
				oldPath: path,
			}),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });
		expect(getFileContents).not.toHaveBeenCalled();
	});

	it("maps GitNotDetectedError to a BUSINESS FeatureError", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () =>
				clientOf({
					getFileContents: () => Promise.reject(new GitNotDetectedError()),
				}),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path: "file.txt" }),
		).rejects.toMatchObject({ name: "FeatureError", code: "BUSINESS" });
	});

	it("maps GitFileTooLargeError to a BUSINESS FeatureError", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () =>
				clientOf({
					getFileContents: () => Promise.reject(new GitFileTooLargeError("new", "file.txt")),
				}),
		});

		await expect(
			service.getDiffContents({ workingDirectory: "/repos/project", path: "file.txt" }),
		).rejects.toMatchObject({ name: "FeatureError", code: "BUSINESS" });
	});
});

describe("GitService createPatch", () => {
	it("runs createWorkingDirectoryPatch with cwd and tempDir", async () => {
		const createWorkingDirectoryPatch = vi.fn(() =>
			Promise.resolve({
				patchPath: "/tmp/patch",
				byteLength: 10,
			}),
		);
		const service = new GitService({
			logger,
			tempDir: "/app-tmp",
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () => clientOf({ createWorkingDirectoryPatch }),
		});

		await service.createPatch({ cwd: "/repos/project" });
		expect(createWorkingDirectoryPatch).toHaveBeenCalledWith({
			cwd: "/repos/project",
			tempDir: "/app-tmp",
		});
	});

	it("omits tempDir when the service was constructed without one", async () => {
		const createWorkingDirectoryPatch = vi.fn(() =>
			Promise.resolve({
				patchPath: "/tmp/patch",
				byteLength: 10,
			}),
		);
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () => clientOf({ createWorkingDirectoryPatch }),
		});

		await service.createPatch({ cwd: "/repos/project" });
		expect(createWorkingDirectoryPatch).toHaveBeenCalledWith({ cwd: "/repos/project" });
	});

	it("passes null through and maps GitNotDetectedError to a FeatureError", async () => {
		const nullService = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/not/a/repo"),
			createClient: () => clientOf({ createWorkingDirectoryPatch: () => Promise.resolve(null) }),
		});
		await expect(nullService.createPatch({ cwd: "/not/a/repo" })).resolves.toBe(null);

		const missingGitService = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () =>
				clientOf({
					createWorkingDirectoryPatch: () => Promise.reject(new GitNotDetectedError()),
				}),
		});
		await expect(missingGitService.createPatch({ cwd: "/repos/project" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
		});
	});

	it("releases a patch from the dispose sweep when releasePatch runs", async () => {
		const releasedPatchPath = await writeFileToTemp("git-service-release-");
		const inFlightPatchPath = await writeFileToTemp("git-service-inflight-");
		const results = [
			{ patchPath: releasedPatchPath, byteLength: 1 },
			{ patchPath: inFlightPatchPath, byteLength: 1 },
		];
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repos/project"),
			createClient: () =>
				clientOf({
					createWorkingDirectoryPatch: () => Promise.resolve(results.shift() ?? null),
				}),
		});

		const released = await service.createPatch({ cwd: "/repos/project" });
		await service.releasePatch(released!.patchPath);
		await expect(stat(releasedPatchPath)).rejects.toMatchObject({ code: "ENOENT" });
		// Already released: the teardown sweep finds nothing left for it.

		const inFlight = await service.createPatch({ cwd: "/repos/project" });
		expect(inFlight).not.toBeNull();
		await service.dispose();
		await expect(stat(inFlightPatchPath)).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("GitService workspace-folder containment", () => {
	function tracingClient() {
		return clientOf({
			status: vi.fn(() => Promise.resolve(null)),
			createWorkingDirectoryPatch: vi.fn(() => Promise.resolve(null)),
			getFileContents: vi.fn(() => Promise.resolve({ oldContents: null, newContents: null })),
		});
	}

	it("allows a directory that equals or is inside a workspace folder", async () => {
		const client = tracingClient();
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/workspaces/project"),
			createClient: () => client,
		});

		await expect(service.status("/workspaces/project")).resolves.toBe(null);
		await expect(service.status("/workspaces/project/nested-repo")).resolves.toBe(null);
		await expect(service.createPatch({ cwd: "/workspaces/project" })).resolves.toBe(null);
		await expect(
			service.getDiffContents({ workingDirectory: "/workspaces/project", path: "file.txt" }),
		).resolves.toEqual({ oldContents: null, newContents: null });
		expect(client.status).toHaveBeenCalledTimes(2);
		expect(client.createWorkingDirectoryPatch).toHaveBeenCalledTimes(1);
		expect(client.getFileContents).toHaveBeenCalledTimes(1);
	});

	it("rejects a directory outside every workspace folder without touching the client", async () => {
		const client = tracingClient();
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/workspaces/project"),
			createClient: () => client,
		});

		await expect(service.status("/workspaces/projector")).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		await expect(service.createPatch({ cwd: "/elsewhere/other" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		await expect(
			service.getDiffContents({ workingDirectory: "/elsewhere/other", path: "file.txt" }),
		).rejects.toMatchObject({ name: "FeatureError", code: "VALIDATION" });
		expect(client.status).not.toHaveBeenCalled();
		expect(client.createWorkingDirectoryPatch).not.toHaveBeenCalled();
		expect(client.getFileContents).not.toHaveBeenCalled();
	});

	it("fails closed with a VALIDATION FeatureError when the workspaces capability is absent", async () => {
		const client = tracingClient();
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: absentFolders(),
			createClient: () => client,
		});

		await expect(service.status("/workspaces/project")).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		await expect(service.createPatch({ cwd: "/workspaces/project" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		expect(client.status).not.toHaveBeenCalled();
		expect(client.createWorkingDirectoryPatch).not.toHaveBeenCalled();
	});
});

describe("GitService hasWorktreeWork", () => {
	it("rejects an outside-workspace directory without touching the client", async () => {
		const status = vi.fn(() => Promise.resolve(null));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/workspaces/project"),
			createClient: () => clientOf({ status }),
		});

		await expect(service.hasWorktreeWork({ directory: "/elsewhere/other" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		expect(status).not.toHaveBeenCalled();
	});

	it("resolves false when a git probe throws (missing binary, spawn failure)", async () => {
		const gitNotDetected = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo/project"),
			createClient: () => clientOf({ status: () => Promise.reject(new GitNotDetectedError()) }),
		});
		await expect(gitNotDetected.hasWorktreeWork({ directory: "/repo/project" })).resolves.toBe(
			false,
		);

		const spawnFailure = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo/project"),
			createClient: () => clientOf({ status: () => Promise.reject(new Error("spawn failed")) }),
		});
		await expect(spawnFailure.hasWorktreeWork({ directory: "/repo/project" })).resolves.toBe(false);
	});

	it("resolves false when the directory is not a repository", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/not/a/repo"),
			createClient: () => clientOf({ status: () => Promise.resolve(null) }),
		});

		await expect(service.hasWorktreeWork({ directory: "/not/a/repo" })).resolves.toBe(false);
	});

	it("resolves true when the worktree has uncommitted changes", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo/project"),
			createClient: () =>
				clientOf({
					status: () =>
						Promise.resolve({
							exists: true,
							currentBranch: "main",
							workingDirectory: {
								files: [{ path: "notes.txt", status: { kind: AppFileStatusKind.Untracked } }],
							},
							doConflictedFilesExist: false,
						}),
				}),
		});

		await expect(
			service.hasWorktreeWork({ directory: "/repo/project", baseBranch: "main" }),
		).resolves.toBe(true);
	});

	it("resolves true when the worktree is commits ahead of the base branch", async () => {
		const exec = vi.fn(async () => ({ exitCode: 0, stdout: "3\n" }));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo/project"),
			createClient: () =>
				clientOf({
					status: statusOn("kilo/topic"),
					exec: exec as unknown as GitClientSlice["exec"],
				}),
		});

		await expect(
			service.hasWorktreeWork({ directory: "/repo/project", baseBranch: "main" }),
		).resolves.toBe(true);
		expect(exec).toHaveBeenCalledWith(["rev-list", "--count", "main..HEAD"], "revListCount", {
			cwd: "/repo/project",
			successExitCodes: new Set([0, 128]),
		});
	});
});

describe("GitService defaultBranch", () => {
	it("rejects an outside-workspace directory without touching the client", async () => {
		const defaultBranchProbe = vi.fn(() => Promise.resolve("main"));
		const branches = vi.fn(() => Promise.resolve([localBranch("main")]));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/workspaces/project"),
			createClient: () => clientOf({ defaultBranch: defaultBranchProbe, branches }),
		});

		await expect(service.defaultBranch("/elsewhere/other")).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		expect(defaultBranchProbe).not.toHaveBeenCalled();
		expect(branches).not.toHaveBeenCalled();
	});

	it("fails closed when the workspaces capability is absent", async () => {
		const defaultBranchProbe = vi.fn(() => Promise.resolve("main"));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: absentFolders(),
			createClient: () => clientOf({ defaultBranch: defaultBranchProbe }),
		});

		await expect(service.defaultBranch("/repo")).rejects.toMatchObject({
			name: "FeatureError",
			code: "VALIDATION",
		});
		expect(defaultBranchProbe).not.toHaveBeenCalled();
	});

	it("resolves the origin/HEAD symref short name first", async () => {
		const defaultBranchProbe = vi.fn(() => Promise.resolve("main"));
		const branches = vi.fn(() => Promise.resolve([localBranch("trunk")]));
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo"),
			createClient: () => clientOf({ defaultBranch: defaultBranchProbe, branches }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBe("main");
		expect(branches).not.toHaveBeenCalled();
	});

	it("falls back to a local main branch", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo"),
			createClient: () =>
				clientOf({ branches: () => Promise.resolve([localBranch("main"), localBranch("dev")]) }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBe("main");
	});

	it("falls back to master when main is absent", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo"),
			createClient: () => clientOf({ branches: () => Promise.resolve([localBranch("master")]) }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBe("master");
	});

	it("resolves null when no candidate exists", async () => {
		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: folders("/repo"),
			createClient: () => clientOf({ branches: () => Promise.resolve([localBranch("trunk")]) }),
		});

		await expect(service.defaultBranch("/repo")).resolves.toBeNull();
	});
});

describe("GitService worktree delegation", () => {
	it("delegates createWorktree to WorktreeManager and passes the result through", async () => {
		const createWorktree = vi.fn(() =>
			Promise.resolve({ directory: "/repo/.kilo/worktrees/kilo-test", branch: "kilo/test" }),
		);
		vi.spyOn(WorktreeManager.prototype, "createWorktree").mockImplementation(createWorktree);

		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: absentFolders(),
			createClient: () => clientOf({}),
		});

		const result = await service.createWorktree({ workingDirectory: "/repo" });

		expect(createWorktree).toHaveBeenCalledWith({ workingDirectory: "/repo" });
		expect(result).toEqual({
			directory: "/repo/.kilo/worktrees/kilo-test",
			branch: "kilo/test",
		});

		vi.restoreAllMocks();
	});

	it("propagates a FeatureError from WorktreeManager without re-wrapping (WorktreeManager maps errors)", async () => {
		// WorktreeManager already maps GitError → FeatureError internally.
		// GitService delegates directly without an extra try/catch layer.
		const featureError = new FeatureError("fatal: not a git repository", "BUSINESS");
		vi.spyOn(WorktreeManager.prototype, "createWorktree").mockRejectedValue(featureError);

		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: absentFolders(),
			createClient: () => clientOf({}),
		});

		await expect(service.createWorktree({ workingDirectory: "/repo" })).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
			message: "fatal: not a git repository",
		});

		vi.restoreAllMocks();
	});

	it("passes FeatureErrors from WorktreeManager through unchanged", async () => {
		const original = new FeatureError(
			"Refusing to remove this directory: it is not a Kilo-managed worktree.",
			"BUSINESS",
		);
		vi.spyOn(WorktreeManager.prototype, "removeWorktree").mockRejectedValue(original);

		const service = new GitService({
			logger,
			getWorkspaceFolderPaths: absentFolders(),
			createClient: () => clientOf({}),
		});

		await expect(service.removeWorktree({ path: "/some/path" })).rejects.toBe(original);

		vi.restoreAllMocks();
	});
});
