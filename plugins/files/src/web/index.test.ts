import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { webRegister, type FilesCapabilities } from "./index.js";

describe("files webRegister", () => {
	it("exposes a file viewer capability that opens a workspace file in the chat panel", () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openContributedTab = vi.fn();
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", { openContributedTab });

		webRegister(filesSdk);
		const capabilities = system.getSdk("kilo-ui").plugins.get<FilesCapabilities>("files");
		capabilities?.fileViewer.openFile({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project",
			relativePath: "src/App.tsx",
			line: 42,
			column: 7,
		});
		expect(capabilities?.fileMentions.Icon).toBeTypeOf("function");

		expect(openContributedTab).toHaveBeenCalledWith(
			"session-1",
			{ id: "files.files", title: "Files" },
			{
				instanceId: "file:files:explorer:/workspace/project/src/App.tsx",
				title: "App.tsx",
				iconKey: "src/App.tsx",
				metadata: {
					explorerId: "files:explorer",
					workspaceDirectory: "/workspace/project",
					relativePath: "src/App.tsx",
					line: "42",
					column: "7",
				},
			},
		);
	});

	it("routes ipynb workspace file links to the notebook panel", async () => {
		const filesSdk = createFakeSdk({ featureId: "files" });
		const system = createFakeFeatureSystem({ sdks: { files: filesSdk } });
		const openContributedTab = vi.fn();
		const openNotebookFile = vi.fn(async () => ({
			sessionId: "session-1",
			notebook_id: "notebook-1",
			title: "analysis.ipynb",
			path: "/workspace/project/notebooks/analysis.ipynb",
		}));
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", { openContributedTab });
		system.getSdk("notebook").plugins.expose("notebookViewer", {
			openFile: openNotebookFile,
		});

		webRegister(filesSdk);
		system.getSdk("kilo-ui").plugins.get<FilesCapabilities>("files")?.fileViewer.openFile({
			sessionId: "session-1",
			workspaceDirectory: "/workspace/project/",
			relativePath: "notebooks/analysis.ipynb",
		});

		await vi.waitFor(() =>
			expect(openNotebookFile).toHaveBeenCalledWith({
				sessionId: "session-1",
				path: "/workspace/project/notebooks/analysis.ipynb",
			}),
		);
		expect(openContributedTab).not.toHaveBeenCalled();
	});
});
