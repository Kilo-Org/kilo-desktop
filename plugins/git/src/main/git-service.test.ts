import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk";
import {
	AppFileStatusKind,
	GitFileTooLargeError,
	GitNotDetectedError,
} from "@anaconda-agentic-desktop/git-client";
import type { IStatusResult } from "@anaconda-agentic-desktop/git-client";

import { GitService, type GitClientSlice } from "./git-service.js";

const logger: MainSdkLogger = {
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
		createWorkingDirectoryPatch: () => Promise.resolve(null),
		getFileContents: () => Promise.resolve({ oldContents: null, newContents: null }),
		...client,
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
