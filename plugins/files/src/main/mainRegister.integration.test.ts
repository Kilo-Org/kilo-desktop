import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

describe("files mainRegister", () => {
	const directories: string[] = [];
	const disposables: Array<() => void> = [];

	afterEach(async () => {
		for (const dispose of disposables.splice(0).reverse()) dispose();
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
	});

	async function boot(exposeWorkspace = true, gitService: Record<string, unknown> | null = null) {
		const root = await mkdtemp(path.join(tmpdir(), "files-main-"));
		const workspace = path.join(root, "workspace");
		await mkdir(workspace);
		await writeFile(path.join(workspace, "hello.txt"), "hello");
		directories.push(root);

		const harness = createFakeSdk({ featureId: "harness" });
		const mainSdk = createFakeMainSdk({ featureId: "files", services: harness.services });
		const kiloSdk = createFakeMainSdk({ featureId: "kilo-ui", services: harness.services });
		if (exposeWorkspace) {
			kiloSdk.plugins.expose("workspaceService", {
				list: async () => [
					{
						id: "workspace-1",
						name: "Workspace",
						folders: [{ path: workspace, isPrimary: true }],
					},
				],
			});
		}
		if (gitService) {
			const gitSdk = createFakeMainSdk({ featureId: "git", services: harness.services });
			gitSdk.plugins.expose("gitService", gitService);
			disposables.push(() => gitSdk.dispose());
		}
		const editorLauncher = {
			listAvailable: vi.fn(async () => ["cursor", "vscode"] as const),
			open: vi.fn(async () => undefined),
		};
		mainRegister(mainSdk, { editorLauncher });
		disposables.push(
			() => harness.destroy(),
			() => kiloSdk.dispose(),
			() => mainSdk.dispose(),
		);
		return { editorLauncher, mainSdk, workspace };
	}

	it("routes validated list and read requests through the real feature router", async () => {
		const { mainSdk, workspace } = await boot();

		await expect(mainSdk.invoke("list", { workspaceDirectory: workspace })).resolves.toEqual({
			paths: ["hello.txt"],
			truncated: false,
		});
		await expect(
			mainSdk.invoke("read", { workspaceDirectory: workspace, relativePath: "hello.txt" }),
		).resolves.toMatchObject({ kind: "text", contents: "hello" });
		await expect(
			mainSdk.invoke("read", { workspaceDirectory: workspace, relativePath: "" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("fails explicitly when Kilo's workspace capability is unavailable", async () => {
		const { mainSdk, workspace } = await boot(false);
		await expect(mainSdk.invoke("list", { workspaceDirectory: workspace })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo workspace service is unavailable.",
		});
	});

	it("resolves null when the workspace is not a git worktree", async () => {
		const gitService = {
			status: vi.fn(async () => ({
				exists: true,
				workingDirectory: {
					files: [{ path: "hello.txt", status: { kind: "Modified" } }],
				},
				doConflictedFilesExist: false,
			})),
		};
		const { mainSdk, workspace } = await boot(true, gitService);

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toBe(
			null,
		);
	});

	const KIND_CASES = [
		[{ kind: "New" }, "added"],
		[{ kind: "Modified" }, "modified"],
		[{ kind: "Deleted" }, "deleted"],
		[{ kind: "Copied", oldPath: "old.txt", renameIncludesModifications: false }, "added"],
		[{ kind: "Renamed", oldPath: "old.txt", renameIncludesModifications: false }, "renamed"],
		[{ kind: "Untracked" }, "untracked"],
		[
			{
				kind: "Conflicted",
				entry: { kind: "conflicted", action: "both-modified", us: "M", them: "M" },
			},
			"modified",
		],
	] as const;

	it.each(KIND_CASES)("maps a $0.kind file to %s decorations", async (fileStatus, expected) => {
		const gitService = {
			status: vi.fn(async () => ({
				exists: true,
				workingDirectory: {
					files: [{ path: "hello.txt", status: fileStatus }],
				},
				doConflictedFilesExist: false,
			})),
		};
		const { mainSdk, workspace } = await boot(true, gitService);
		await mkdir(path.join(workspace, ".git"));

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toEqual({
			entries: [{ path: "hello.txt", status: expected }],
		});
	});

	it("skips files with a status kind outside the asserted union instead of failing", async () => {
		const gitService = {
			status: vi.fn(async () => ({
				exists: true,
				workingDirectory: {
					files: [
						{ path: "hello.txt", status: { kind: "Modified" } },
						{ path: "mystery.txt", status: { kind: "TypeChanged" } },
					],
				},
				doConflictedFilesExist: false,
			})),
		};
		const { mainSdk, workspace } = await boot(true, gitService);
		await mkdir(path.join(workspace, ".git"));

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toEqual({
			entries: [{ path: "hello.txt", status: "modified" }],
		});
	});

	it("treats a .git file (linked worktree or submodule) as a worktree root", async () => {
		const gitService = {
			status: vi.fn(async () => ({
				exists: true,
				workingDirectory: {
					files: [{ path: "hello.txt", status: { kind: "Untracked" } }],
				},
				doConflictedFilesExist: false,
			})),
		};
		const { mainSdk, workspace } = await boot(true, gitService);
		await writeFile(path.join(workspace, ".git"), "gitdir: ../elsewhere\n");

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toEqual({
			entries: [{ path: "hello.txt", status: "untracked" }],
		});
	});

	it("resolves null when the git plugin is not available", async () => {
		const { mainSdk, workspace } = await boot();
		await mkdir(path.join(workspace, ".git"));

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toBe(
			null,
		);
	});

	it("resolves null when the git capability reports no repository", async () => {
		const gitService = { status: vi.fn(async () => null) };
		const { mainSdk, workspace } = await boot(true, gitService);
		await mkdir(path.join(workspace, ".git"));

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toBe(
			null,
		);
	});

	it("resolves null when the git capability throws", async () => {
		const gitService = {
			status: vi.fn(async () => {
				throw new Error("git binary missing");
			}),
		};
		const { mainSdk, workspace } = await boot(true, gitService);
		await mkdir(path.join(workspace, ".git"));

		await expect(mainSdk.invoke("gitStatus", { workspaceDirectory: workspace })).resolves.toBe(
			null,
		);
	});

	it("rejects git status for an unregistered workspace directory", async () => {
		const gitService = { status: vi.fn(async () => null) };
		const { mainSdk } = await boot(true, gitService);
		const unregistered = await mkdtemp(path.join(tmpdir(), "files-unregistered-"));
		directories.push(unregistered);

		await expect(
			mainSdk.invoke("gitStatus", { workspaceDirectory: unregistered }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("opens only a canonical file inside a registered workspace", async () => {
		const { editorLauncher, mainSdk, workspace } = await boot();

		await expect(mainSdk.invoke("listExternalEditors")).resolves.toEqual({
			editors: ["cursor", "vscode"],
		});
		await expect(
			mainSdk.invoke("openExternalEditor", {
				workspaceDirectory: workspace,
				relativePath: "hello.txt",
				editor: "vscode",
			}),
		).resolves.toEqual({ opened: true });
		expect(editorLauncher.open).toHaveBeenCalledWith(
			"vscode",
			await realpath(path.join(workspace, "hello.txt")),
		);

		await expect(
			mainSdk.invoke("openExternalEditor", {
				workspaceDirectory: workspace,
				relativePath: "../outside.txt",
				editor: "vscode",
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(editorLauncher.open).toHaveBeenCalledTimes(1);
	});
});
