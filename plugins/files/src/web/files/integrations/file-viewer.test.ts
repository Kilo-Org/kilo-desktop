import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { openWorkspaceFile } from "./file-viewer.js";

describe("openWorkspaceFile", () => {
	const fileOptions = {
		sessionId: "session-1",
		workspaceDirectory: "/workspace",
		relativePath: "docs/readme.md",
	};

	it("reports whether the file opened", async () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		await expect(openWorkspaceFile(filesSdk, fileOptions)).resolves.toBe(false);

		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", { openContributedTab: vi.fn() });
		await expect(openWorkspaceFile(filesSdk, fileOptions)).resolves.toBe(true);
	});

	it("reports a failed notebook open as not opened", async () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const notebook = { ...fileOptions, relativePath: "analysis.ipynb" };
		await expect(openWorkspaceFile(filesSdk, notebook)).resolves.toBe(false);

		const openFile = vi.fn(async () => ({ error: "kernel unavailable" }));
		system.getSdk("notebook").plugins.expose("notebookViewer", { openFile });
		await expect(openWorkspaceFile(filesSdk, notebook)).resolves.toBe(false);

		openFile.mockResolvedValueOnce({} as { error: string });
		await expect(openWorkspaceFile(filesSdk, notebook)).resolves.toBe(true);
	});

	it("opens a distinct file pane owned by the requesting explorer", () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openContributedTab = vi.fn();
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", { openContributedTab });

		openWorkspaceFile(filesSdk, {
			sessionId: "session-1",
			workspaceDirectory: "/workspace",
			relativePath: "docs/readme.md",
			explorerId: "files:explorer",
		});

		expect(openContributedTab).toHaveBeenCalledWith(
			"session-1",
			{ id: "files.files", title: "Files" },
			{
				instanceId: "file:files:explorer:/workspace/docs/readme.md",
				title: "readme.md",
				iconKey: "docs/readme.md",
				metadata: {
					explorerId: "files:explorer",
					workspaceDirectory: "/workspace",
					relativePath: "docs/readme.md",
				},
			},
		);
	});

	it("lets a second explorer open the same path as its own pane", () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openContributedTab = vi.fn();
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", { openContributedTab });

		openWorkspaceFile(filesSdk, {
			sessionId: "session-1",
			workspaceDirectory: "/workspace",
			relativePath: "docs/readme.md",
			explorerId: "files:other",
		});

		expect(openContributedTab).toHaveBeenCalledWith(
			"session-1",
			{ id: "files.files", title: "Files" },
			{
				instanceId: "file:files:other:/workspace/docs/readme.md",
				title: "readme.md",
				iconKey: "docs/readme.md",
				metadata: {
					explorerId: "files:other",
					workspaceDirectory: "/workspace",
					relativePath: "docs/readme.md",
				},
			},
		);
	});

	it("reuses an open file tab when no explorer is specified", () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openContributedTab = vi.fn();
		const activateTab = vi.fn();
		const updateTab = vi.fn();
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
			openContributedTab,
			activateTab,
			updateTab,
			listTabs: () => [
				{
					instanceId: "file:files:other:/workspace/docs/readme.md",
					definitionId: "files.files",
					metadata: {
						explorerId: "files:other",
						workspaceDirectory: "/workspace",
						relativePath: "docs/readme.md",
					},
				},
			],
		});

		openWorkspaceFile(filesSdk, {
			sessionId: "session-1",
			workspaceDirectory: "/workspace",
			relativePath: "docs/readme.md",
			line: 12,
		});

		expect(openContributedTab).not.toHaveBeenCalled();
		expect(activateTab).toHaveBeenCalledWith(
			"session-1",
			"file:files:other:/workspace/docs/readme.md",
		);
		expect(updateTab).toHaveBeenCalledWith(
			"session-1",
			"file:files:other:/workspace/docs/readme.md",
			{
				metadata: {
					explorerId: "files:other",
					workspaceDirectory: "/workspace",
					relativePath: "docs/readme.md",
					line: "12",
				},
			},
		);
	});

	it("does not reuse a matching tab owned by another contribution", () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openContributedTab = vi.fn();
		const activateTab = vi.fn();
		const updateTab = vi.fn();
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
			openContributedTab,
			activateTab,
			updateTab,
			listTabs: () => [
				{
					instanceId: "preview-1",
					definitionId: "preview.preview",
					metadata: {
						workspaceDirectory: "/workspace",
						relativePath: "docs/readme.md",
					},
				},
			],
		});

		openWorkspaceFile(filesSdk, {
			sessionId: "session-1",
			workspaceDirectory: "/workspace",
			relativePath: "docs/readme.md",
		});

		expect(updateTab).not.toHaveBeenCalled();
		expect(activateTab).not.toHaveBeenCalled();
		expect(openContributedTab).toHaveBeenCalledWith(
			"session-1",
			{ id: "files.files", title: "Files" },
			expect.objectContaining({
				instanceId: "file:files:explorer:/workspace/docs/readme.md",
			}),
		);
	});
});
