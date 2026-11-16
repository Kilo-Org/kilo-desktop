// Boots kilo.files' main entry on a real main kernel, with stand-ins under
// the real manifests: kilo.core (only its `tool` point) and
// kilo.work-sessions (workspaces, work sessions and panes in memory), plus a
// `kilo.work-sessions/vcs` contribution when a status is scripted. Either
// stand-in can be left out to check kilo.files works without it.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import {
	definePlugin,
	type DomainObjectProvider,
	type KernelLogger,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	Vcs,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	Workspaces,
	type Pane,
	type VcsFileChange,
	type VcsImplementation,
	type VcsStatus,
	type WorkSession,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { Documents, FILES_DEFINITIONS, FILES_PLUGIN_ID, OPEN_FILE_TOOL_ID } from "../contracts";
import { FILES_PANE_KIND } from "../contracts/panes";
import { createFilesMainEntry } from "./entry";

const directories: string[] = [];
const kernels: MainKernel[] = [];

/** Stops every kernel and removes every folder booted since the last call (an `afterEach`). */
export async function stopFilesMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
}

/** A workspace folder (`hello.txt`, `src/a.ts`) and a docs folder (`guide.md`) in a temp root. */
export async function workspaceOnDisk() {
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

export function workSession(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: "w1",
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

export const vcsStatus = (files: readonly VcsFileChange[]): VcsStatus => ({
	exists: true,
	workingDirectory: { files },
	doConflictedFilesExist: false,
});

export interface BootOptions {
	/** Leaves kilo.work-sessions out entirely. */
	readonly withoutWorkSessions?: boolean;
	/** Leaves kilo.core out. */
	readonly withoutCore?: boolean;
	/** kilo.work-sessions without its workspaces. */
	readonly withoutWorkspaces?: boolean;
	readonly denyFolders?: boolean;
	readonly withoutPanes?: boolean;
	readonly vcsStatus?: VcsImplementation["status"];
	readonly workSessions?: readonly WorkSession[];
	readonly logger?: KernelLogger;
}

const unused = () => {
	throw new Error("unused");
};

/**
 * kilo.work-sessions in main: one workspace over the given folders, the work
 * sessions, and panes whose `openObject` opens a file in a Files pane (once
 * per file), recording what was opened.
 */
function fakeWorkSessions(
	options: BootOptions,
	folders: readonly { id: string; path: string; isPrimary: boolean; position: number }[],
) {
	const opened: { workSessionId: string; ref: { type: string; id: string } }[] = [];
	let panes: DomainObjectProvider<typeof Panes> | undefined;
	const current = (workSessionId: string) =>
		panes!.state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
	const put = (workSessionId: string, pane: Pane) =>
		panes!.setState({
			byWorkSession: {
				...panes!.state.byWorkSession,
				[workSessionId]: {
					...current(workSessionId),
					panes: [...current(workSessionId).panes.filter((p) => p.id !== pane.id), pane],
				},
			},
		});

	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			if (!options.withoutWorkspaces) {
				sdk.domainObjects.provide(Workspaces, {
					initialState: {
						workspaces: [
							{ id: "w1", name: "App", folders: [...folders], createdAt: 0, updatedAt: 0 },
						],
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
			}
			sdk.domainObjects.provide(WorkSessions, {
				initialState: { workSessions: [...(options.workSessions ?? [workSession("s1")])] },
				methods: {
					create: unused,
					createChat: unused,
					rename: unused,
					setPinned: unused,
					setArchived: unused,
					setBranch: unused,
					remove: unused,
					isolationOptions: () => null,
				},
			});
			if (options.withoutPanes) return;
			panes = sdk.domainObjects.provide(Panes, {
				initialState: { byWorkSession: {} },
				methods: {
					open: unused,
					openObject: ({ workSessionId, ref }) => {
						opened.push({ workSessionId, ref });
						const existing = current(workSessionId).panes.find(
							(pane) => pane.object?.id === ref.id,
						);
						const pane: Pane = existing ?? {
							id: `pane_${current(workSessionId).panes.length + 1}`,
							kind: FILES_PANE_KIND,
							title: "Files",
							object: ref,
							metadata: {},
							ordinal: 1,
						};
						put(workSessionId, pane);
						if (!existing) panes!.emit("opened", { workSessionId, pane });
						return pane;
					},
					activate: unused,
					update: ({ workSessionId, paneId, title, iconKey, metadata }) => {
						const pane = current(workSessionId).panes.find((candidate) => candidate.id === paneId)!;
						const next: Pane = {
							...pane,
							...(title === undefined ? {} : { title }),
							...(iconKey === undefined ? {} : { iconKey }),
							...(metadata ? { metadata } : {}),
						};
						put(workSessionId, next);
						return next;
					},
					close: unused,
					setLayout: unused,
					setArrangement: unused,
				},
			});
		},
	});

	return {
		registration: {
			manifest: workSessionsManifest,
			definitions: WORK_SESSIONS_DEFINITIONS,
			entry,
		},
		opened,
		panes: (workSessionId: string) => (panes ? current(workSessionId).panes : []),
		/** A pane opened by another plugin's opener, as kilo.work-sessions announces it. */
		emitOpened: (workSessionId: string, pane: Pane) => {
			put(workSessionId, pane);
			panes!.emit("opened", { workSessionId, pane });
		},
	};
}

function vcsContribution(status: VcsImplementation["status"]) {
	return testPlugin("test.vcs", {
		manifest: { contributes: { extensions: { "kilo.work-sessions/vcs": [{ id: "git" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(Vcs, "git", { status } as unknown as VcsImplementation);
			},
		},
	});
}

/** kilo.files' main entry with its stand-ins; external editors are `cursor` and `vscode`. */
export async function bootFilesMain(options: BootOptions = {}) {
	const { workspace, docs, root } = await workspaceOnDisk();
	const folders = [
		{ id: "f1", path: workspace, isPrimary: true, position: 0 },
		{ id: "f2", path: docs, isPrimary: false, position: 1 },
	];
	const workSessions = fakeWorkSessions(options, folders);
	const editorLauncher = {
		listAvailable: async () => ["cursor", "vscode"] as const,
		open: vi.fn(async () => undefined),
	};
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [
			...(options.withoutCore
				? []
				: [
						{
							manifest: coreManifest,
							definitions: CORE_DEFINITIONS,
							entry: definePlugin({ activate() {} }),
						},
					]),
			...(options.withoutWorkSessions ? [] : [workSessions.registration]),
			...(options.vcsStatus ? [vcsContribution(options.vcsStatus)] : []),
			{
				manifest,
				definitions: FILES_DEFINITIONS,
				entry: createFilesMainEntry({ editorLauncher }),
			},
		],
		hostServices: (pluginId) => ({ storage: createMemoryStorage(`/data/${pluginId}`) }),
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(kernel);
	await kernel.start();

	const documents = kernel.kernelSdk.domainObjects.get(Documents)!;
	const tool = kernel.kernelSdk.extensions
		.list(Tool)
		.find((contribution) => contribution.key === `${FILES_PLUGIN_ID}/${OPEN_FILE_TOOL_ID}`);
	const context = (workSessionId: string | null): ToolCallContext => ({
		workSessionId,
		workspaceId: workSessionId ? "w1" : null,
		chatId: workSessionId ? "chat" : null,
		callId: "call_1",
		external: workSessionId === null,
		signal: new AbortController().signal,
	});
	const callTool = (input: unknown, workSessionId: string | null = "s1") =>
		Promise.resolve(
			tool!.implementation!.run(tool!.implementation!.input.parse(input), context(workSessionId)),
		);
	return {
		kernel,
		root,
		workspace,
		docs,
		documents,
		tool,
		callTool,
		editorLauncher,
		opened: workSessions.opened,
		emitOpened: workSessions.emitOpened,
		panes: (workSessionId = "s1") => workSessions.panes(workSessionId),
	};
}

/** A logger recording warnings and errors. */
export function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}
