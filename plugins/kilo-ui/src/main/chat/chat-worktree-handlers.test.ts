import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";
import { FeatureError } from "@kilo-desktop/feature-sdk/main";

import { mainRegister } from "../index.js";
import { createChatWorktreeHandlers } from "./chat-worktree-handlers.js";

const PLUGIN_DIR = path.resolve(import.meta.dirname, "../../..");

interface GitServiceDouble {
	createWorktree: ReturnType<typeof vi.fn>;
	renameWorktreeBranch: ReturnType<typeof vi.fn>;
	removeWorktree: ReturnType<typeof vi.fn>;
	hasWorktreeWork: ReturnType<typeof vi.fn>;
}

const directories: string[] = [];
const disposables: Array<() => void> = [];

afterEach(async () => {
	for (const dispose of disposables.splice(0).reverse()) {
		dispose();
	}
	await Promise.all(
		directories
			.splice(0)
			.map((directory) =>
				rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
			),
	);
});

async function boot() {
	const userData = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-chat-"));
	const storageDir = path.join(userData, "plugins", "kilo-ui");
	await mkdir(storageDir, { recursive: true });
	await mkdir(path.join(userData, "Project"));
	// macOS temp dirs live behind a symlink the workspace service resolves.
	const project = await realpath(path.join(userData, "Project"));
	directories.push(userData);

	const harnessSdk = createFakeSdk({ featureId: "test-harness" });
	const mainSdk = createFakeMainSdk({
		featureId: "kilo-ui",
		storageDir,
		pluginDir: PLUGIN_DIR,
		services: harnessSdk.services,
	});
	const gitSdk = createFakeMainSdk({ featureId: "git", services: harnessSdk.services });

	mainRegister(mainSdk);
	disposables.push(
		() => harnessSdk.destroy(),
		() => gitSdk.dispose(),
		() => mainSdk.dispose(),
	);

	const exposeGitService = (service: GitServiceDouble) => {
		gitSdk.plugins.expose("gitService", { ...service });
	};
	const workspace = (await mainSdk.invoke("create", {
		folders: [{ path: project, isPrimary: true }],
	})) as { id: string };

	return { mainSdk, exposeGitService, project, workspace };
}

function gitServiceDouble(overrides?: Partial<GitServiceDouble>): GitServiceDouble {
	return {
		createWorktree: vi.fn(async () => ({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			branch: "kilo/aback-aardvark",
		})),
		renameWorktreeBranch: vi.fn(async () => ({ branch: "kilo/fix-the-login-bug" })),
		removeWorktree: vi.fn(async () => undefined),
		hasWorktreeWork: vi.fn(async () => true),
		...overrides,
	};
}

describe("kilo-ui chat worktree handlers", () => {
	it("prepares a session in the workspace checkout without a worktree request", async () => {
		const { mainSdk, exposeGitService, project, workspace } = await boot();
		exposeGitService(gitServiceDouble());

		const preparation = await mainSdk.invoke("chat.prepareSession", { workspaceId: workspace.id });

		expect(preparation).toEqual({
			directory: project,
			workspaceId: workspace.id,
			workspaceFolders: [{ path: project, isPrimary: true }],
		});
	});

	it("creates a worktree when requested and stamps its branch", async () => {
		const { mainSdk, exposeGitService, project, workspace } = await boot();
		const gitService = gitServiceDouble();
		exposeGitService(gitService);

		const preparation = await mainSdk.invoke("chat.prepareSession", {
			workspaceId: workspace.id,
			worktree: { baseBranch: "main" },
		});

		expect(gitService.createWorktree).toHaveBeenCalledWith({
			workingDirectory: project,
			baseBranch: "main",
		});
		expect(preparation).toEqual({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			workspaceId: workspace.id,
			workspaceFolders: [{ path: "/repo/.kilo/worktrees/kilo-aback-aardvark", isPrimary: true }],
			worktree: { branch: "kilo/aback-aardvark" },
		});
	});

	it("passes a worktree warning through the preparation contract", async () => {
		const { mainSdk, exposeGitService, workspace } = await boot();
		exposeGitService(
			gitServiceDouble({
				createWorktree: vi.fn(async () => ({
					directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
					branch: "kilo/aback-aardvark",
					warning: "Could not fetch latest main from origin; branched from local state.",
				})),
			}),
		);

		const preparation = await mainSdk.invoke("chat.prepareSession", {
			workspaceId: workspace.id,
			worktree: {},
		});

		expect(preparation).toMatchObject({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			worktree: {
				branch: "kilo/aback-aardvark",
				warning: "Could not fetch latest main from origin; branched from local state.",
			},
		});
	});

	it("keeps non-primary folders when re-rooting the primary at the worktree", async () => {
		const { mainSdk, exposeGitService, project } = await boot();
		const secondaryReal = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-chat-secondary-"));
		directories.push(secondaryReal);
		const secondary = await realpath(secondaryReal);
		const multi = (await mainSdk.invoke("create", {
			folders: [
				{ path: project, isPrimary: true },
				{ path: secondary, isPrimary: false },
			],
		})) as { id: string };
		exposeGitService(gitServiceDouble());

		const preparation = await mainSdk.invoke("chat.prepareSession", {
			workspaceId: multi.id,
			worktree: {},
		});

		expect(preparation).toEqual({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			workspaceId: multi.id,
			workspaceFolders: [
				{ path: "/repo/.kilo/worktrees/kilo-aback-aardvark", isPrimary: true },
				{ path: secondary, isPrimary: false },
			],
			worktree: { branch: "kilo/aback-aardvark" },
		});
	});

	it("rejects an unscoped worktree request without a workspace", async () => {
		const { mainSdk } = await boot();

		await expect(mainSdk.invoke("chat.prepareSession", { worktree: {} })).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
			message: "Worktree sessions require a workspace.",
		});
	});

	it("forwards a worktree request without a base branch verbatim", async () => {
		const { mainSdk, exposeGitService, workspace } = await boot();
		const gitService = gitServiceDouble();
		exposeGitService(gitService);

		await mainSdk.invoke("chat.prepareSession", {
			workspaceId: workspace.id,
			worktree: {},
		});

		expect(gitService.createWorktree).toHaveBeenCalledWith({
			workingDirectory: expect.any(String),
		});
	});

	it("rejects a worktree request when the git capability is missing", async () => {
		const { mainSdk, workspace } = await boot();

		await expect(
			mainSdk.invoke("chat.prepareSession", {
				workspaceId: workspace.id,
				worktree: {},
			}),
		).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
			message: expect.stringContaining("Git worktrees are unavailable"),
		});
	});

	it("routes rename requests to the capability with the directory as path", async () => {
		const { mainSdk, exposeGitService } = await boot();
		const gitService = gitServiceDouble();
		exposeGitService(gitService);

		await expect(
			mainSdk.invoke("chat.renameWorktreeBranch", {
				directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "fix the login bug",
			}),
		).resolves.toEqual({ branch: "kilo/fix-the-login-bug" });

		expect(gitService.renameWorktreeBranch).toHaveBeenCalledWith({
			path: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			currentBranch: "kilo/aback-aardvark",
			requestedBranch: "fix the login bug",
		});
	});

	it("declines rename with null when the git capability is missing", async () => {
		const { mainSdk } = await boot();

		await expect(
			mainSdk.invoke("chat.renameWorktreeBranch", {
				directory: "/repo",
				currentBranch: "kilo/aback-aardvark",
				requestedBranch: "fix the login bug",
			}),
		).resolves.toBeNull();
	});

	it("routes worktree removal to the capability", async () => {
		const { mainSdk, exposeGitService } = await boot();
		const gitService = gitServiceDouble();
		exposeGitService(gitService);

		await expect(
			mainSdk.invoke("chat.removeWorktree", {
				directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			}),
		).resolves.toBeUndefined();

		expect(gitService.removeWorktree).toHaveBeenCalledWith({
			path: "/repo/.kilo/worktrees/kilo-aback-aardvark",
		});
	});

	it("releases the directory's Kilo instance before removing the worktree", async () => {
		const { mainSdk, exposeGitService } = await boot();
		const calls: string[] = [];
		exposeGitService(
			gitServiceDouble({
				removeWorktree: vi.fn(async () => {
					calls.push("removeWorktree");
				}),
			}),
		);
		const dispose = vi.fn(async (directory: string) => {
			calls.push(`dispose ${directory}`);
		});
		const handlers = createChatWorktreeHandlers(mainSdk, {} as never, dispose);

		await handlers["chat.removeWorktree"]({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
		});

		expect(calls).toEqual(["dispose /repo/.kilo/worktrees/kilo-aback-aardvark", "removeWorktree"]);
	});

	it("still removes the worktree when releasing the Kilo instance fails", async () => {
		const { mainSdk, exposeGitService } = await boot();
		const gitService = gitServiceDouble();
		exposeGitService(gitService);
		const handlers = createChatWorktreeHandlers(
			mainSdk,
			{} as never,
			vi.fn(async () => {
				throw new Error("Kilo Server is unavailable.");
			}),
		);

		await handlers["chat.removeWorktree"]({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
		});

		expect(gitService.removeWorktree).toHaveBeenCalledWith({
			path: "/repo/.kilo/worktrees/kilo-aback-aardvark",
		});
	});

	it("rejects worktree removal when the git capability is missing", async () => {
		const { mainSdk } = await boot();

		await expect(
			mainSdk.invoke("chat.removeWorktree", {
				directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			}),
		).rejects.toMatchObject({
			name: "FeatureError",
			code: "BUSINESS",
			message: expect.stringContaining("Git worktrees are unavailable"),
		});
	});

	it("routes the worktree work check to the capability", async () => {
		const { mainSdk, exposeGitService } = await boot();
		const gitService = gitServiceDouble();
		exposeGitService(gitService);

		await expect(
			mainSdk.invoke("chat.hasWorktreeWork", {
				directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
				baseBranch: "main",
			}),
		).resolves.toBe(true);

		expect(gitService.hasWorktreeWork).toHaveBeenCalledWith({
			directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			baseBranch: "main",
		});
	});

	it("resolves false when the worktree work check fails (channel contract: false on any failure)", async () => {
		const { mainSdk, exposeGitService } = await boot();
		const gitService = gitServiceDouble({
			// Including a containment rejection — the channel contract is
			// literal: any failure is `false`.
			hasWorktreeWork: vi.fn(async () => {
				throw new FeatureError('"elsewhere" is not inside a workspace folder.', "VALIDATION");
			}),
		});
		exposeGitService(gitService);

		await expect(
			mainSdk.invoke("chat.hasWorktreeWork", {
				directory: "/elsewhere/worktree",
			}),
		).resolves.toBe(false);
	});

	it("declines the worktree work check with false when the git capability is missing", async () => {
		const { mainSdk } = await boot();

		await expect(
			mainSdk.invoke("chat.hasWorktreeWork", {
				directory: "/repo/.kilo/worktrees/kilo-aback-aardvark",
			}),
		).resolves.toBe(false);
	});
});
