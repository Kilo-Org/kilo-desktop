import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin, type DomainProvider, type PluginEntry } from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { AgentTool, type ToolCallContext } from "@kilo-desktop/plugin-agent/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WorkSessions,
	SESSIONS_DEFINITIONS,
	type Pane,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Vcs,
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type VcsFileChange,
	type VcsImplementation,
	type VcsStatus,
} from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../plugin.json";
import { Documents, FILES_DEFINITIONS } from "../contracts/index.js";
import { FILE_OBJECT_TYPE, FILES_PANE_KIND } from "../contracts/panes.js";
import { createFilesMainEntry } from "./entry.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function workspaceOnDisk() {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-files-")));
	directories.push(root);
	const workspace = path.join(root, "workspace");
	const docs = path.join(root, "docs");
	await mkdir(path.join(workspace, "src"), { recursive: true });
	await mkdir(docs);
	await writeFile(path.join(workspace, "hello.txt"), "hello");
	await writeFile(path.join(workspace, "src", "a.ts"), "export {};");
	await writeFile(path.join(docs, "guide.md"), "# Guide");
	return { root, workspace, docs };
}

function session(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: "w1",
		worktreeBranch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

interface BootOptions {
	readonly withoutWorkspaces?: boolean;
	readonly denyFolders?: boolean;
	readonly withoutPanes?: boolean;
	readonly vcsStatus?: VcsImplementation["status"];
	readonly sessions?: readonly WorkSession[];
}

async function boot(options: BootOptions = {}) {
	const { workspace, docs, root } = await workspaceOnDisk();
	const folders = [
		{ id: "f1", path: workspace, isPrimary: true, position: 0 },
		{ id: "f2", path: docs, isPrimary: false, position: 1 },
	];
	const unused = () => {
		throw new Error("unused");
	};
	const opened: { sessionId: string; ref: { type: string; id: string } }[] = [];
	let panes!: DomainProvider<typeof Panes>;

	const workspacesMain: PluginEntry = definePlugin({
		activate(sdk) {
			if (options.withoutWorkspaces) return;
			sdk.domains.provide(Workspaces, {
				initialState: {
					workspaces: [{ id: "w1", name: "App", folders, createdAt: 0, updatedAt: 0 }],
					activeId: null,
					unavailableFolderIds: [],
				},
				methods: {
					create: unused,
					update: unused,
					remove: unused,
					setActive: unused,
					authorize: ({ path: candidate, rule }) => ({
						allowed:
							!options.denyFolders &&
							rule === "folder" &&
							folders.some((folder) => folder.path === candidate),
					}),
					checkFolders: unused,
				},
			});
		},
	});

	const sessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(WorkSessions, {
				initialState: { sessions: [...(options.sessions ?? [session("s1")])] },
				methods: {
					create: unused,
					rename: unused,
					setPinned: unused,
					setArchived: unused,
					setWorktreeBranch: unused,
					remove: unused,
					importLegacyPins: unused,
					isolationOptions: () => null,
				},
			});
			if (options.withoutPanes) return;
			const current = (sessionId: string) =>
				panes.state.bySession[sessionId] ?? EMPTY_WORK_SESSION_PANES;
			const put = (sessionId: string, pane: Pane) =>
				panes.setState({
					bySession: {
						...panes.state.bySession,
						[sessionId]: {
							...current(sessionId),
							panes: [...current(sessionId).panes.filter((p) => p.id !== pane.id), pane],
						},
					},
				});
			panes = sdk.domains.provide(Panes, {
				initialState: { bySession: {} },
				methods: {
					open: unused,
					openObject: ({ sessionId, ref }) => {
						opened.push({ sessionId, ref });
						const existing = current(sessionId).panes.find(
							(pane) => pane.metadata["objectId"] === ref.id,
						);
						const pane: Pane = existing ?? {
							id: `pane_${current(sessionId).panes.length + 1}`,
							kind: FILES_PANE_KIND,
							title: "Files",
							metadata: { objectType: ref.type, objectId: ref.id },
							ordinal: 1,
						};
						put(sessionId, pane);
						if (!existing) panes.emit("opened", { sessionId, pane });
						return pane;
					},
					activate: unused,
					update: ({ sessionId, paneId, title, iconKey, metadata }) => {
						const pane = current(sessionId).panes.find((candidate) => candidate.id === paneId)!;
						const next: Pane = {
							...pane,
							...(title === undefined ? {} : { title }),
							...(iconKey === undefined ? {} : { iconKey }),
							...(metadata ? { metadata } : {}),
						};
						put(sessionId, next);
						return next;
					},
					close: unused,
					setLayout: unused,
					setArrangement: unused,
					importLegacy: unused,
				},
			});
		},
	});

	const registrations = [
		testPlugin("kilo.agent", {
			manifest: { extensionPoints: [{ id: "tool", kind: "additive" }] },
			definitions: { extensionPoints: [AgentTool] },
		}),
		{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS, entry: workspacesMain },
		{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, entry: sessionsMain },
		...(options.vcsStatus
			? [
					testPlugin("kilo.git", {
						manifest: { contributes: { extensions: { "kilo.workspaces/vcs": [{ id: "git" }] } } },
						entry: {
							activate: (sdk) => {
								sdk.extensions.implement(Vcs, "git", {
									status: options.vcsStatus,
								} as unknown as VcsImplementation);
							},
						},
					}),
				]
			: []),
		{
			manifest,
			definitions: FILES_DEFINITIONS,
			entry: createFilesMainEntry({
				editorLauncher: {
					listAvailable: async () => ["cursor", "vscode"],
					open: vi.fn(async () => undefined),
				},
			}),
		},
	];
	const { main } = await createTestKernelPair({ main: registrations, renderer: [] });
	const documents = main.kernelSdk.domains.get(Documents)!;
	const tool = main.kernelSdk.extensions
		.list(AgentTool)
		.find((contribution) => contribution.key === "kilo.files/open")!;
	const context = (sessionId: string | null): ToolCallContext => ({
		sessionId,
		chatId: sessionId ? "chat" : null,
		callId: "call_1",
		external: sessionId === null,
		signal: new AbortController().signal,
	});
	const callTool = (input: unknown, sessionId: string | null = "s1") =>
		Promise.resolve(
			tool.implementation!.run(tool.implementation!.input.parse(input), context(sessionId)),
		);
	return {
		main,
		root,
		workspace,
		docs,
		documents,
		tool,
		callTool,
		opened,
		panes: (sessionId = "s1") => panes.state.bySession[sessionId]?.panes ?? [],
	};
}

const status = (files: readonly VcsFileChange[]): VcsStatus => ({
	exists: true,
	workingDirectory: { files },
	doConflictedFilesExist: false,
});

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
			documents.methods.read({ workspaceDirectory: workspace, relativePath: "" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("refuses folders outside the workspaces, and everything without kilo.workspaces", async () => {
		const { documents, root } = await boot();
		await expect(documents.methods.list({ workspaceDirectory: root })).rejects.toMatchObject({
			code: "VALIDATION",
			message: "Workspace directory is not registered.",
		});

		const without = await boot({ withoutWorkspaces: true });
		await expect(
			without.documents.methods.list({ workspaceDirectory: without.workspace }),
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
		const { documents, workspace } = await boot();

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
		await expect(
			documents.methods.openExternalEditor({
				workspaceDirectory: workspace,
				relativePath: "../outside.txt",
				editor: "vscode",
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});
});

describe("git status decorations through kilo.workspaces/vcs", () => {
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

		expect(tool.metadata).toMatchObject({ title: "Open file", external: false });
	});

	it("opens a file of the calling session through the openers, at a line and column", async () => {
		const { callTool, opened, panes, workspace } = await boot();

		const result = await callTool({ path: "src/a.ts", line: 3, column: 2 });

		expect(opened).toEqual([
			{ sessionId: "s1", ref: { type: FILE_OBJECT_TYPE, id: path.join(workspace, "src", "a.ts") } },
		]);
		expect(result).toEqual({
			sessionId: "s1",
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
				metadata: { objectId: path.join(workspace, "src", "a.ts"), line: "3", column: "2" },
			}),
		);
	});

	it("opens files in any of the session's folders, and in its worktree instead of the primary", async () => {
		const { callTool, docs, workspace } = await boot();
		await expect(callTool({ path: path.join(docs, "guide.md") })).resolves.toMatchObject({
			workspaceDirectory: docs,
			relativePath: "guide.md",
		});

		const worktree = await boot({
			sessions: [session("s1", { worktreeBranch: "kilo/x", directory: "/elsewhere/worktree" })],
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

	it("needs a calling session with folders and panes", async () => {
		const { callTool, opened } = await boot({
			sessions: [session("s1"), session("loose", { workspaceId: null })],
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
