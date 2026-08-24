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

	async function boot(exposeWorkspace = true) {
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
