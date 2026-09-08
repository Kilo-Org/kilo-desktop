import { describe, expect, it, vi } from "vitest";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk";
import { AppFileStatusKind, GitNotDetectedError } from "@anaconda-agentic-desktop/git-client";
import type { IStatusResult } from "@anaconda-agentic-desktop/git-client";

import { GitService, type GitClientSlice } from "./git-service.js";

const logger: MainSdkLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

function clientOf(client: GitClientSlice): GitClientSlice {
	return client;
}

describe("GitService", () => {
	it("rejects with a BUSINESS FeatureError when the git binary is not found", async () => {
		const service = new GitService({
			logger,
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
