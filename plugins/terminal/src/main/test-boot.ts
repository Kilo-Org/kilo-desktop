// Boots kilo.terminal's main entry on a real main kernel (and a window), with
// stand-ins under the real manifests: kilo.core (only its `tool` point) and
// kilo.work-sessions (workspaces authorising one primary folder, one work
// session, and panes in memory). Either stand-in can be left out to check
// kilo.terminal works without it.
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import {
	definePlugin,
	type DomainObjectProvider,
	type KernelLogger,
	type KernelPort,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createMemoryStorage, createTestKernelPair } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	Workspaces,
	type Pane,
	type WorkSession,
	type WorkSessionPanes,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { TERMINAL_DEFINITIONS, Terminals } from "../contracts";
import type { TerminalReadout } from "../contracts/session";
import { createTerminalMainEntry, type TerminalManagerDeps } from "./entry";
import type { TerminalSessionManager } from "./sessions/TerminalSessionManager";

const directories: string[] = [];
const kernels: { stop(): Promise<void> }[] = [];

/** Stops every kernel and removes every folder made since the last call (an `afterEach`). */
export async function stopTerminalMains(): Promise<void> {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
}

export async function tempDir(prefix: string): Promise<string> {
	const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
	directories.push(directory);
	return directory;
}

export const WORK_SESSION: WorkSession = {
	id: "wses_1",
	title: "Session",
	titleSource: "default",
	pinned: false,
	archived: false,
	archiveChangedAt: 0,
	workspaceId: null,
	branch: null,
	directory: null,
	chatIds: [],
	createdAt: 1,
	updatedAt: 1,
};

export const terminalPane = (id: string, metadata: Record<string, string> = {}): Pane => ({
	id,
	kind: "kilo.terminal/terminal",
	title: "Terminal",
	metadata,
	ordinal: 1,
});

const unused = () => {
	throw new Error("unused");
};

/**
 * kilo.work-sessions in main: workspaces authorising one primary folder, and
 * panes in memory. Deleting a work session drops its panes before announcing
 * it, as the real one may (its own listener can run first), and without
 * `closed` events.
 */
function fakeWorkSessionsMain(initial: Record<string, WorkSessionPanes>, primary: () => string) {
	let panes!: DomainObjectProvider<typeof Panes>;
	let workSessions!: DomainObjectProvider<typeof WorkSessions>;
	const of = (workSessionId: string) =>
		panes.state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
	const write = (workSessionId: string, next: WorkSessionPanes | null) => {
		const byWorkSession = { ...panes.state.byWorkSession };
		if (next) byWorkSession[workSessionId] = next;
		else delete byWorkSession[workSessionId];
		panes.setState({ byWorkSession });
	};
	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Workspaces, {
				initialState: { workspaces: [], activeId: null, unavailableFolderIds: [] },
				methods: {
					create: unused,
					update: unused,
					remove: () => ({ deleted: false }),
					setActive: () => undefined,
					authorize: ({ path: target, rule }) =>
						rule === "primary" && target === primary()
							? { allowed: true, workspaceId: "w", folder: target, path: target }
							: { allowed: false },
					checkFolders: () => undefined,
					newFolderLocation: () => ({ path: null }),
					newFolderPath: () => {
						throw new Error("newFolderPath is not faked here.");
					},
					rememberNewFolderLocation: () => undefined,
				},
			});
			workSessions = sdk.domainObjects.provide(WorkSessions, {
				initialState: { workSessions: [WORK_SESSION] },
				methods: {
					create: () => WORK_SESSION,
					createChat: unused,
					forkChat: unused,
					rename: () => WORK_SESSION,
					setPinned: () => WORK_SESSION,
					setArchived: () => WORK_SESSION,
					setBranch: () => WORK_SESSION,
					remove: ({ id }) => {
						write(id, null);
						workSessions.emit("deleted", { workSession: { ...WORK_SESSION, id } });
						return { deleted: true };
					},
					isolationOptions: () => null,
				},
			});
			panes = sdk.domainObjects.provide(Panes, {
				initialState: { byWorkSession: initial },
				methods: {
					open: ({ workSessionId, kind }) => {
						const pane: Pane = {
							id: `pane_${of(workSessionId).panes.length + 1}`,
							kind,
							title: "Terminal",
							metadata: {},
							ordinal: 1,
						};
						write(workSessionId, {
							...of(workSessionId),
							panes: [...of(workSessionId).panes, pane],
						});
						return pane;
					},
					openObject: () => null,
					activate: () => undefined,
					update: ({ workSessionId, paneId, title }) => {
						const current = of(workSessionId);
						const pane = {
							...current.panes.find((candidate) => candidate.id === paneId)!,
							...(title ? { title } : {}),
						};
						write(workSessionId, {
							...current,
							panes: current.panes.map((candidate) => (candidate.id === paneId ? pane : candidate)),
						});
						return pane;
					},
					close: ({ workSessionId, paneId }) => {
						const current = of(workSessionId);
						const pane = current.panes.find((candidate) => candidate.id === paneId);
						if (!pane) return { closed: false };
						write(workSessionId, {
							...current,
							panes: current.panes.filter((p) => p !== pane),
						});
						panes.emit("closed", { workSessionId, pane });
						return { closed: true };
					},
					setLayout: () => undefined,
					setArrangement: () => undefined,
				},
			});
		},
	});
	return { entry, panes: () => panes };
}

/** A session manager recording what the entry asks of it. */
export function fakeManager() {
	return {
		deps: undefined as TerminalManagerDeps | undefined,
		attach: vi.fn(async (_port: KernelPort, _args: unknown) => undefined),
		close: vi.fn(async () => undefined),
		read: vi.fn(
			async (_identity: { sessionId: string; terminalId: string }, _lines: number) =>
				null as TerminalReadout | null,
		),
		isRunning: vi.fn((_identity: { sessionId: string; terminalId: string }) => false),
		dispose: vi.fn(async () => undefined),
	};
}

export interface BootOptions {
	readonly panes?: Record<string, WorkSessionPanes>;
	readonly manager?: (
		deps: TerminalManagerDeps,
	) => ReturnType<typeof fakeManager> | TerminalSessionManager;
	readonly storageDir?: string;
	readonly originStorageDir?: string;
	readonly primary?: string;
	readonly embedded?: boolean;
	/** Leaves kilo.work-sessions out entirely. */
	readonly withoutWorkSessions?: boolean;
	/** Leaves kilo.core out. */
	readonly withoutCore?: boolean;
	readonly logger?: KernelLogger;
}

/** kilo.terminal's main entry with its stand-ins, and a window. */
export async function bootTerminalMain(options: BootOptions = {}) {
	const workSessions = fakeWorkSessionsMain(
		options.panes ?? {},
		() => options.primary ?? "/nowhere",
	);
	const fake = fakeManager();
	const storage = createMemoryStorage(options.storageDir ?? "/data/kilo.terminal");
	const register = vi.fn((_registration: Record<string, unknown>) => () => undefined);
	const entry = createTerminalMainEntry({
		createManager: (deps) => {
			fake.deps = deps;
			return options.manager?.(deps) ?? fake;
		},
		homeDirectory: os.tmpdir(),
		...(options.originStorageDir ? { originStorageDir: () => options.originStorageDir! } : {}),
	});
	const core = (withEntry: boolean): PluginRegistration[] =>
		options.withoutCore
			? []
			: [
					{
						manifest: coreManifest,
						definitions: CORE_DEFINITIONS,
						...(withEntry ? { entry: definePlugin({ activate() {} }) } : {}),
					},
				];
	const sessions = (withEntry: boolean): PluginRegistration[] =>
		options.withoutWorkSessions
			? []
			: [
					{
						manifest: workSessionsManifest,
						definitions: WORK_SESSIONS_DEFINITIONS,
						...(withEntry ? { entry: workSessions.entry } : {}),
					},
				];
	const { main, renderer } = await createTestKernelPair({
		main: [
			...core(true),
			...sessions(true),
			{ manifest, definitions: TERMINAL_DEFINITIONS, entry },
		],
		renderer: [
			...core(false),
			...sessions(false),
			{ manifest, definitions: TERMINAL_DEFINITIONS, entry: definePlugin({ activate: () => {} }) },
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? {
						storage,
						...(options.embedded === false ? {} : { embeddedHosts: { register } }),
						assets: { resolve: (subpath: string) => `/app/${subpath}` },
					}
				: { storage: createMemoryStorage(`/data/${pluginId}`) },
		...(options.logger ? { logger: options.logger } : {}),
	});
	kernels.push(main);
	const terminals = main.kernelSdk.domainObjects.get(Terminals)!;
	return { main, renderer, workSessions, fake, storage, register, terminals };
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
