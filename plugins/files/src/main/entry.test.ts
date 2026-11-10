import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Tool } from "@kilo-desktop/plugin-core/contracts";

import { FILE_OBJECT_TYPE, FILES_PANE_KIND } from "../contracts/panes";
import {
	bootFilesMain,
	recordingLogger,
	stopFilesMains,
	vcsStatus as status,
	workSession,
} from "./test-boot";

afterEach(stopFilesMains);

const boot = bootFilesMain;

describe("kilo.files' documents in main", () => {
	it("lists and reads files in a workspace folder, validating input", async () => {
		const { documents, workspace } = await boot();

		await expect(documents.methods.list({ workspaceDirectory: workspace })).resolves.toEqual({
			paths: ["hello.txt", "src/", "src/a.ts"],
			truncated: false,
		});
		await expect(
			documents.methods.read({ workspaceDirectory: workspace, relativePath: "hello.txt" }),
		).resolves.toMatchObject({ kind: "text", contents: "hello" });
		await expect(
			documents.methods.existingPaths({
				workspaceDirectory: workspace,
				relativePaths: ["hello.txt", "missing.txt", "src"],
			}),
		).resolves.toEqual({ paths: ["hello.txt"] });
		await expect(
			documents.methods.resolveFileLink({ workspaceDirectory: workspace, relativePath: "a.ts" }),
		).resolves.toMatchObject({ kind: "matches", paths: ["src/a.ts"] });
		await expect(
			documents.methods.read({ workspaceDirectory: workspace, relativePath: "" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("refuses folders outside the workspaces, and everything without kilo.work-sessions' workspaces", async () => {
		const { documents, root } = await boot();
		await expect(documents.methods.list({ workspaceDirectory: root })).rejects.toMatchObject({
			code: "VALIDATION",
			message: "Workspace directory is not registered.",
		});

		const without = await boot({ withoutWorkspaces: true });
		await expect(
			without.documents.methods.list({ workspaceDirectory: without.workspace }),
		).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Workspaces are unavailable." });

		const withoutWorkSessions = await boot({ withoutWorkSessions: true });
		await expect(
			withoutWorkSessions.documents.methods.list({
				workspaceDirectory: withoutWorkSessions.workspace,
			}),
		).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Workspaces are unavailable." });
	});

	it("saves over the revision read and reports conflicts", async () => {
		const { documents, workspace } = await boot();
		const read = await documents.methods.read({
			workspaceDirectory: workspace,
			relativePath: "hello.txt",
		});
		if (read.kind !== "text" || !read.revision) throw new Error("Expected a text read");

		const saved = await documents.methods.write({
			workspaceDirectory: workspace,
			relativePath: "hello.txt",
			contents: "changed",
			expectedRevision: read.revision,
		});
		expect(saved.status).toBe("saved");
		await expect(
			documents.methods.write({
				workspaceDirectory: workspace,
				relativePath: "hello.txt",
				contents: "again",
				expectedRevision: read.revision,
			}),
		).resolves.toMatchObject({ status: "conflict" });
	});

	it("lists and launches external editors for files inside the folder", async () => {
		const { documents, workspace, editorLauncher } = await boot();

		await expect(documents.methods.listExternalEditors(undefined)).resolves.toEqual({
			editors: ["cursor", "vscode"],
		});
		await expect(
			documents.methods.openExternalEditor({
				workspaceDirectory: workspace,
				relativePath: "hello.txt",
				editor: "vscode",
			}),
		).resolves.toEqual({ opened: true });
		expect(editorLauncher.open).toHaveBeenCalledWith("vscode", path.join(workspace, "hello.txt"));
		await expect(
			documents.methods.openExternalEditor({
				workspaceDirectory: workspace,
				relativePath: "../outside.txt",
				editor: "vscode",
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});
});

describe("git status decorations through kilo.work-sessions/vcs", () => {
	const KIND_CASES = [
		["New", "added"],
		["Modified", "modified"],
		["Deleted", "deleted"],
		["Copied", "added"],
		["Renamed", "renamed"],
		["Untracked", "untracked"],
		["Conflicted", "modified"],
	] as const;

	it.each(KIND_CASES)("maps a %s file to %s", async (kind, expected) => {
		const { documents, workspace } = await boot({
			vcsStatus: async () => status([{ path: "hello.txt", status: { kind } }]),
		});
		await mkdir(path.join(workspace, ".git"));

		await expect(documents.methods.gitStatus({ workspaceDirectory: workspace })).resolves.toEqual({
			entries: [{ path: "hello.txt", status: expected }],
		});
	});

	it("asks the provider about the folder only when it is a worktree root", async () => {
		const vcsStatus = vi.fn(async () => status([{ path: "hello.txt", status: { kind: "New" } }]));
		const { documents, workspace } = await boot({ vcsStatus });

		await expect(
			documents.methods.gitStatus({ workspaceDirectory: workspace }),
		).resolves.toBeNull();
		expect(vcsStatus).not.toHaveBeenCalled();

		await writeFile(path.join(workspace, ".git"), "gitdir: ../elsewhere\n");
		await expect(documents.methods.gitStatus({ workspaceDirectory: workspace })).resolves.toEqual({
			entries: [{ path: "hello.txt", status: "added" }],
		});
		expect(vcsStatus).toHaveBeenCalledWith(workspace);
	});

	it("skips unknown kinds, and degrades to null without a provider, a repository or on failure", async () => {
		const unknown = await boot({
			vcsStatus: async () =>
				status([
					{ path: "hello.txt", status: { kind: "Modified" } },
					{ path: "odd.txt", status: { kind: "TypeChanged" as never } },
				]),
		});
		await mkdir(path.join(unknown.workspace, ".git"));
		await expect(
			unknown.documents.methods.gitStatus({ workspaceDirectory: unknown.workspace }),
		).resolves.toEqual({ entries: [{ path: "hello.txt", status: "modified" }] });

		for (const vcsStatus of [
			undefined,
			async () => null,
			async () => {
				throw new Error("git binary missing");
			},
		]) {
			const { documents, workspace } = await boot(vcsStatus ? { vcsStatus } : {});
			await mkdir(path.join(workspace, ".git"));
			await expect(
				documents.methods.gitStatus({ workspaceDirectory: workspace }),
			).resolves.toBeNull();
		}
	});
});

describe("the open agent tool", () => {
	it("is offered to Kilo chats only, as Open file", async () => {
		const { tool } = await boot();

		expect(tool?.metadata).toMatchObject({ title: "Open file", external: false });
	});

	it("opens a file of the calling work session through the openers, at a line and column", async () => {
		const { callTool, opened, panes, workspace } = await boot();

		const result = await callTool({ path: "src/a.ts", line: 3, column: 2 });

		expect(opened).toEqual([
			{
				workSessionId: "s1",
				ref: { type: FILE_OBJECT_TYPE, id: path.join(workspace, "src", "a.ts") },
			},
		]);
		expect(result).toEqual({
			workSessionId: "s1",
			paneId: "pane_1",
			workspaceDirectory: workspace,
			relativePath: "src/a.ts",
			line: 3,
			column: 2,
		});
		await vi.waitFor(() =>
			expect(panes()[0]).toMatchObject({
				title: "a.ts",
				iconKey: "a.ts",
				object: { type: FILE_OBJECT_TYPE, id: path.join(workspace, "src", "a.ts") },
				metadata: { line: "3", column: "2", revealRequest: expect.any(String) },
			}),
		);
	});

	it("reveals a new line in a pane already showing the file, dropping the old column", async () => {
		const { callTool, panes } = await boot();
		await callTool({ path: "src/a.ts", line: 3, column: 2 });
		const first = panes()[0]!.metadata["revealRequest"];

		await expect(callTool({ path: "src/a.ts", line: 9 })).resolves.toMatchObject({
			paneId: "pane_1",
			line: 9,
		});
		expect(panes()).toHaveLength(1);
		expect(panes()[0]!.metadata).toEqual({ line: "9", revealRequest: expect.any(String) });
		expect(panes()[0]!.metadata["revealRequest"]).not.toBe(first);

		await expect(callTool({ path: "src/a.ts" })).resolves.toEqual(
			expect.not.objectContaining({ line: expect.anything() }),
		);
	});

	it("opens files in any of the work session's folders, and in its isolated copy instead of the primary", async () => {
		const { callTool, docs, workspace } = await boot();
		await expect(callTool({ path: path.join(docs, "guide.md") })).resolves.toMatchObject({
			workspaceDirectory: docs,
			relativePath: "guide.md",
		});

		const worktree = await boot({
			workSessions: [workSession("s1", { branch: "kilo/x", directory: "/elsewhere/worktree" })],
		});
		await expect(worktree.callTool({ path: path.join(workspace, "hello.txt") })).rejects.toThrow(
			"is outside this chat's workspace folders: /elsewhere/worktree",
		);
	});

	it("refuses paths outside the folders, folders, and missing files", async () => {
		const { callTool, root, workspace } = await boot();

		await expect(callTool({ path: path.join(root, "secret.txt") })).rejects.toThrow(
			"is outside this chat's workspace folders",
		);
		await expect(callTool({ path: "../secret.txt" })).rejects.toThrow("is outside");
		await expect(callTool({ path: workspace })).rejects.toThrow("is a folder, not a file.");
		await expect(callTool({ path: "src" })).rejects.toThrow("File not found (or not a file)");
		await expect(callTool({ path: "missing.ts" })).rejects.toThrow("File not found");
	});

	it("needs a calling work session with folders and panes", async () => {
		const { callTool, opened } = await boot({
			workSessions: [workSession("s1"), workSession("loose", { workspaceId: null })],
		});

		await expect(callTool({ path: "hello.txt" }, null)).rejects.toThrow(
			"requires an originating Kilo chat session",
		);
		await expect(callTool({ path: "hello.txt" }, "loose")).rejects.toThrow(
			"This chat has no workspace folders",
		);
		expect(opened).toEqual([]);

		const withoutPanes = await boot({ withoutPanes: true });
		await expect(withoutPanes.callTool({ path: "hello.txt" })).rejects.toThrow(
			"The session's panes are unavailable.",
		);
	});

	it("reports a failed existence check", async () => {
		const { callTool, opened } = await boot({ denyFolders: true });

		await expect(callTool({ path: "hello.txt" })).rejects.toThrow(
			'Could not check whether "hello.txt" exists: Workspace directory is not registered.',
		);
		expect(opened).toEqual([]);
	});
});

describe("file panes other openers create", () => {
	it("are titled with their file's name; other panes are left alone", async () => {
		const { emitOpened, panes, workspace } = await boot();
		const file = path.join(workspace, "hello.txt");

		emitOpened("s1", {
			id: "explorer",
			kind: FILES_PANE_KIND,
			title: "Files",
			metadata: { workspaceDirectory: workspace },
			ordinal: 1,
		});
		emitOpened("s1", {
			id: "page",
			kind: "kilo.browser/browser",
			title: "Browser",
			object: { type: FILE_OBJECT_TYPE, id: file },
			metadata: {},
			ordinal: 1,
		});
		emitOpened("s1", {
			id: "file",
			kind: FILES_PANE_KIND,
			title: "Files",
			object: { type: FILE_OBJECT_TYPE, id: file },
			metadata: {},
			ordinal: 2,
		});

		await vi.waitFor(() =>
			expect(panes().find((pane) => pane.id === "file")).toMatchObject({
				title: "hello.txt",
				iconKey: "hello.txt",
			}),
		);
		expect(panes().find((pane) => pane.id === "explorer")?.title).toBe("Files");
		expect(panes().find((pane) => pane.id === "page")?.title).toBe("Browser");
	});
});

describe("kilo.files in main without the plugins below it", () => {
	it("activates with no errors or warnings of its own without kilo.work-sessions and kilo.core", async () => {
		const { logger, warnings, errors } = recordingLogger();

		const { kernel, documents, workspace } = await boot({
			withoutWorkSessions: true,
			withoutCore: true,
			logger,
		});

		expect(kernel.kernelSdk.extensions.list(Tool)).toEqual([]);
		await expect(documents.methods.listExternalEditors(undefined)).resolves.toEqual({
			editors: ["cursor", "vscode"],
		});
		await expect(
			documents.methods.gitStatus({ workspaceDirectory: workspace }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
		// The kernel reports kilo.files' manifest contributions to absent plugins; the entry says nothing.
		const own = warnings.filter(
			([message]) => !String(message).startsWith("[kilo.files] Contribution"),
		);
		expect(own).toEqual([]);
		expect(errors).toEqual([]);
	});
});
