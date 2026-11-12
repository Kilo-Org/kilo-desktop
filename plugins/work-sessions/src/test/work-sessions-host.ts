// The implementation of `./testing` (src/testing/index.ts): a test host for
// kilo.work-sessions' window areas and for plugins that contribute to them:
// boots the real shell and kilo.work-sessions' real web entry over an
// in-memory stand-in for its main-process domain objects.
import { workSessionsWebEntry } from "../web";
import type { ComponentType } from "react";
import { vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelError,
	KernelNotifications,
	KernelTelemetrySink,
	type DomainObjectProvider,
	type FlagValue,
	type PluginEntry,
	type PluginSdk,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import type { MainKernel, MainKernelHost } from "@kilo-desktop/kernel/main";
import { testManifest } from "@kilo-desktop/kernel/testing";
import {
	Chats,
	type ChatActivity,
	type ChatSummary,
	type PermissionRequest,
} from "@kilo-desktop/plugin-core/contracts";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import {
	DEFAULT_WORK_SESSION_TITLE,
	EMPTY_WORK_SESSION_PANES,
	LayoutPresets,
	PaneKind,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WORK_SESSIONS_PLUGIN_ID,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type IsolationOptions,
	type LayoutPreset,
	type OpenPaneInput,
	type Pane,
	type PaneImplementation,
	type PaneKindMetadata,
	type PaneProps,
	type WorkSession,
	type WorkSessionPanes,
	type Workspace,
} from "../contracts";

export type { GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

export const NOW = Date.now();

// --- Records ---

export function workSession(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: `Session ${id}`,
		titleSource: "user",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: null,
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: NOW - 60_000,
		updatedAt: NOW - 60_000,
		...patch,
	};
}

export function workspace(id: string, name: string, patch: Partial<Workspace> = {}): Workspace {
	return {
		id,
		name,
		color: "#5EA0F7",
		folders: [
			{ id: `f-${id}`, path: `/projects/${name.toLowerCase()}`, isPrimary: true, position: 0 },
		],
		createdAt: 1,
		updatedAt: 1,
		...patch,
	};
}

export function pane(id: string, kind: string, patch: Partial<Pane> = {}): Pane {
	return { id, kind, title: id, metadata: {}, ordinal: 1, ...patch };
}

/** One work session's panes, the first active. */
export function panesOf(panes: readonly Pane[], patch: Partial<WorkSessionPanes> = {}) {
	return {
		...EMPTY_WORK_SESSION_PANES,
		panes: [...panes],
		activePaneId: panes[0]?.id ?? null,
		...patch,
	};
}

export function chat(
	id: string,
	activity: Partial<ChatActivity> = {},
	patch: Partial<ChatSummary> = {},
): ChatSummary {
	return {
		id,
		title: id,
		directory: "/projects/app",
		parentId: null,
		workspaceId: null,
		worktreeBranch: null,
		workspaceFolders: [],
		workSessionId: null,
		createdAt: NOW - 60_000,
		updatedAt: NOW - 60_000,
		activity: { status: "idle", pendingPermissionIds: [], pendingQuestionIds: [], ...activity },
		...patch,
	};
}

// --- Main stand-in ---

export interface WorkSessionsMainState {
	readonly workSessions?: readonly WorkSession[];
	readonly workspaces?: readonly Workspace[];
	readonly activeWorkspaceId?: string | null;
	/** Panes by work session id. */
	readonly panes?: Readonly<Record<string, WorkSessionPanes>>;
	/** Saved layout presets; null leaves the layout presets domain object out. */
	readonly presets?: readonly LayoutPreset[] | null;
	readonly defaultPresetId?: string | null;
	/** What `isolationOptions` answers; a version control contribution (`hasVcs`) is present when set. */
	readonly isolation?: IsolationOptions | null;
	/** `remove({removeCopy})` reports this copy removal failure. */
	readonly copyError?: string;
}

/**
 * Stands in for kilo.work-sessions' main entry: workspaces, work sessions,
 * panes and layout presets kept in memory, recording calls. Pane opening
 * follows the pane kinds' manifest rules (singleton, title) as main does.
 */
export function fakeWorkSessionsMain(initial: WorkSessionsMainState = {}) {
	const calls = {
		create: vi.fn(),
		rename: vi.fn(),
		setPinned: vi.fn(),
		setArchived: vi.fn(),
		remove: vi.fn(),
		removeCopy: vi.fn(),
		isolationOptions: vi.fn(),
		setActiveWorkspace: vi.fn(),
		openPane: vi.fn(),
		activatePane: vi.fn(),
		closePane: vi.fn(),
		setLayout: vi.fn(),
		setArrangement: vi.fn(),
		savePreset: vi.fn(),
	};
	let failNext: string | undefined;
	let held: Promise<void> | undefined;
	let heldIsolation: { workspaceId: string; until: Promise<void> } | undefined;
	let workSessions: DomainObjectProvider<typeof WorkSessions> | undefined;
	let workspaces: DomainObjectProvider<typeof Workspaces> | undefined;
	let panes: DomainObjectProvider<typeof Panes> | undefined;
	let presets: DomainObjectProvider<typeof LayoutPresets> | undefined;
	let nextId = 0;
	const fail = () => {
		if (!failNext) return;
		const message = failNext;
		failNext = undefined;
		throw new KernelError("VALIDATION", message);
	};

	function provideWorkSessions(sdk: PluginSdk) {
		const provider: DomainObjectProvider<typeof WorkSessions> = sdk.domainObjects.provide(
			WorkSessions,
			{
				initialState: { workSessions: [...(initial.workSessions ?? [])] },
				methods: {
					create: async (input) => {
						calls.create(input);
						const hold = held;
						held = undefined;
						await hold;
						fail();
						const created = workSession(`wses_${provider.state.workSessions.length + 1}`, {
							title: DEFAULT_WORK_SESSION_TITLE,
							titleSource: "default",
							workspaceId: input.workspaceId ?? null,
							createdAt: Date.now(),
							updatedAt: Date.now(),
						});
						provider.setState({ workSessions: [...provider.state.workSessions, created] });
						provider.emit("created", { workSession: created });
						return created;
					},
					createChat: () => {
						throw new KernelError("UNAVAILABLE", "No chats in this test.");
					},
					rename: ({ id, title }) => change(id, { title }, () => calls.rename(id, title)),
					setPinned: ({ id, pinned }) => change(id, { pinned }, () => calls.setPinned(id, pinned)),
					setArchived: ({ id, archived }) =>
						change(id, { archived }, () => calls.setArchived(id, archived)),
					setBranch: ({ id, branch }) => change(id, { branch }, () => {}),
					remove: ({ id, removeCopy }) => {
						calls.remove(id);
						fail();
						const removed = provider.state.workSessions.find((entry) => entry.id === id);
						provider.setState({
							workSessions: provider.state.workSessions.filter((entry) => entry.id !== id),
						});
						if (removed) provider.emit("deleted", { workSession: removed });
						if (!removeCopy) return { deleted: true };
						calls.removeCopy(id);
						return initial.copyError
							? { deleted: true, copyRemoved: false, copyError: initial.copyError }
							: { deleted: true, copyRemoved: true };
					},
					isolationOptions: async ({ workspaceId }) => {
						calls.isolationOptions(workspaceId);
						if (heldIsolation?.workspaceId === workspaceId) await heldIsolation.until;
						return initial.isolation ?? null;
					},
				},
			},
		);
		function change(id: string, patch: Partial<WorkSession>, record: () => void): WorkSession {
			record();
			fail();
			const before = provider.state.workSessions.find((entry) => entry.id === id);
			if (!before) throw new KernelError("NOT_FOUND", `No work session ${id}.`);
			const after = { ...before, ...patch };
			provider.setState({
				workSessions: provider.state.workSessions.map((entry) => (entry.id === id ? after : entry)),
			});
			provider.emit("updated", { before, after });
			return after;
		}
		return provider;
	}

	function provideWorkspaces(sdk: PluginSdk) {
		sdk.context.set("hasWorkspaces", (initial.workspaces ?? []).length > 0);
		sdk.context.set("hasVcs", initial.isolation !== undefined);
		const unused = () => {
			throw new KernelError("UNAVAILABLE", "Not in this test.");
		};
		const provider: DomainObjectProvider<typeof Workspaces> = sdk.domainObjects.provide(
			Workspaces,
			{
				initialState: {
					workspaces: [...(initial.workspaces ?? [])],
					activeId: initial.activeWorkspaceId ?? null,
					unavailableFolderIds: [],
				},
				methods: {
					create: unused,
					update: unused,
					remove: unused,
					setActive: ({ id }) => {
						calls.setActiveWorkspace(id);
						provider.setState({ ...provider.state, activeId: id });
					},
					authorize: () => ({ allowed: false }),
					checkFolders: () => undefined,
				},
			},
		);
		return provider;
	}

	function providePanes(sdk: PluginSdk) {
		const kindOf = (kind: string): PaneKindMetadata | undefined =>
			sdk.extensions.list(PaneKind).find((contribution) => contribution.key === kind)?.metadata;
		const provider: DomainObjectProvider<typeof Panes> = sdk.domainObjects.provide(Panes, {
			initialState: { byWorkSession: { ...(initial.panes ?? {}) } },
			methods: {
				open: (input) => open(input),
				openObject: () => null,
				activate: ({ workSessionId, paneId }) => {
					calls.activatePane(paneId);
					write(workSessionId, { ...of(workSessionId), activePaneId: paneId });
				},
				update: ({ workSessionId, paneId, status, object, ...patch }) => {
					const current = of(workSessionId);
					const before = current.panes.find((entry) => entry.id === paneId);
					if (!before) throw new KernelError("NOT_FOUND", `No pane ${paneId}.`);
					const after: Pane = { ...before };
					if (patch.title !== undefined) after.title = patch.title;
					if (patch.iconKey !== undefined) after.iconKey = patch.iconKey;
					if (patch.metadata !== undefined) after.metadata = patch.metadata;
					if (status === null) delete after.status;
					else if (status !== undefined) after.status = status;
					if (object === null) delete after.object;
					else if (object !== undefined) after.object = object;
					write(workSessionId, {
						...current,
						panes: current.panes.map((entry) => (entry.id === paneId ? after : entry)),
					});
					return after;
				},
				close: ({ workSessionId, paneId }) => {
					calls.closePane(paneId);
					const current = of(workSessionId);
					const closed = current.panes.find((entry) => entry.id === paneId);
					if (!closed) return { closed: false };
					const rest = current.panes.filter((entry) => entry.id !== paneId);
					write(workSessionId, {
						...current,
						panes: rest,
						activePaneId:
							current.activePaneId === paneId ? (rest.at(-1)?.id ?? null) : current.activePaneId,
					});
					provider.emit("closed", { workSessionId, pane: closed });
					return { closed: true };
				},
				setLayout: ({ workSessionId, layout, activePaneId }) => {
					calls.setLayout(layout);
					write(workSessionId, {
						...of(workSessionId),
						layout,
						...(activePaneId !== undefined ? { activePaneId } : {}),
					});
				},
				setArrangement: ({ workSessionId, arrangement }) => {
					calls.setArrangement(arrangement);
					write(workSessionId, { ...of(workSessionId), arrangement });
				},
			},
		});
		function of(workSessionId: string): WorkSessionPanes {
			return provider.state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
		}
		function write(workSessionId: string, next: WorkSessionPanes) {
			provider.setState({
				byWorkSession: { ...provider.state.byWorkSession, [workSessionId]: next },
			});
		}
		function open(input: OpenPaneInput): Pane {
			calls.openPane(input);
			fail();
			const current = of(input.workSessionId);
			const metadata = kindOf(input.kind);
			const existing =
				current.panes.find((entry) => input.paneId !== undefined && entry.id === input.paneId) ??
				(metadata?.singleton
					? current.panes.find((entry) => entry.kind === input.kind)
					: undefined);
			const activate = input.activate ?? true;
			if (existing) {
				if (activate) write(input.workSessionId, { ...current, activePaneId: existing.id });
				return existing;
			}
			const ordinal = current.panes.filter((entry) => entry.kind === input.kind).length + 1;
			const opened: Pane = {
				id: input.paneId ?? `pane_${++nextId}`,
				kind: input.kind,
				title: input.title ?? metadata?.title ?? input.kind,
				metadata: input.metadata ?? {},
				ordinal,
				...(input.iconKey ? { iconKey: input.iconKey } : {}),
				...(input.object ? { object: input.object } : {}),
			};
			write(input.workSessionId, {
				...current,
				panes: [...current.panes, opened],
				activePaneId: activate ? opened.id : current.activePaneId,
			});
			provider.emit("opened", { workSessionId: input.workSessionId, pane: opened });
			return opened;
		}
		return provider;
	}

	function provideLayoutPresets(sdk: PluginSdk) {
		const provider: DomainObjectProvider<typeof LayoutPresets> = sdk.domainObjects.provide(
			LayoutPresets,
			{
				initialState: {
					presets: [...(initial.presets ?? [])],
					defaultPresetId: initial.defaultPresetId ?? null,
				},
				methods: {
					save: ({ id, name, template, makeDefault }) => {
						calls.savePreset({ id, name, makeDefault });
						fail();
						const saved = { id: id ?? `preset_${++nextId}`, name, template };
						const others = provider.state.presets.filter((entry) => entry.id !== saved.id);
						provider.setState({
							presets: [...others, saved],
							defaultPresetId: makeDefault ? saved.id : provider.state.defaultPresetId,
						});
						return saved;
					},
					rename: ({ id, name }) => {
						fail();
						provider.setState({
							...provider.state,
							presets: provider.state.presets.map((entry) =>
								entry.id === id ? { ...entry, name } : entry,
							),
						});
					},
					remove: ({ id }) => {
						fail();
						provider.setState({
							presets: provider.state.presets.filter((entry) => entry.id !== id),
							defaultPresetId:
								provider.state.defaultPresetId === id ? null : provider.state.defaultPresetId,
						});
					},
					setDefault: ({ id }) => {
						fail();
						provider.setState({ ...provider.state, defaultPresetId: id });
					},
				},
			},
		);
		return provider;
	}

	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			workspaces = provideWorkspaces(sdk);
			workSessions = provideWorkSessions(sdk);
			panes = providePanes(sdk);
			if (initial.presets !== null) presets = provideLayoutPresets(sdk);
		},
	});
	return {
		entry,
		calls,
		/** Holds the next `create` (as a copy being made would) until released. */
		holdNextCreate: () => {
			let release!: () => void;
			held = new Promise((resolve) => (release = resolve));
			return release;
		},
		/** Holds `isolationOptions` for a workspace (as reading a slow repository would) until released. */
		holdIsolationOptions: (workspaceId: string) => {
			let release!: () => void;
			heldIsolation = { workspaceId, until: new Promise((resolve) => (release = resolve)) };
			return () => {
				heldIsolation = undefined;
				release();
			};
		},
		/** The next failing-capable call rejects with `message`. */
		failNextWith: (message: string) => (failNext = message),
		workSessions: () => workSessions!,
		workspaces: () => workspaces!,
		panes: () => panes!,
		presets: () => presets!,
	};
}

export type FakeWorkSessionsMain = ReturnType<typeof fakeWorkSessionsMain>;

// --- kilo.core's chats ---

/**
 * Stands in for kilo.core's chats in main: their state and live events. Run
 * `activate` as (part of) renderShell's `core` stand-in.
 */
export function fakeChats(initial: readonly ChatSummary[]) {
	let provider: DomainObjectProvider<typeof Chats> | undefined;
	const deleted = vi.fn<(id: string) => void>();
	let permissionRequests: readonly PermissionRequest[] = [];
	const unused = () => {
		throw new KernelError("UNAVAILABLE", "Not in this test.");
	};
	return {
		activate(sdk: PluginSdk) {
			provider = sdk.domainObjects.provide(Chats, {
				initialState: {
					ready: true,
					chats: Object.fromEntries(initial.map((summary) => [summary.id, summary])),
					declinedSignInTools: [],
				},
				methods: {
					create: unused,
					setWorktreeBranch: unused,
					chatConfig: unused,
					rename: unused,
					delete: ({ id }) => deleted(id),
					prompt: unused,
					abort: unused,
					setArchived: unused,
					permissionRequests: ({ id }) =>
						permissionRequests.filter((request) => request.chatId === id),
					replyPermission: unused,
					replyQuestion: unused,
					rejectQuestion: unused,
					declineSignInTools: unused,
				},
			});
		},
		deleted,
		/** The permission requests the server reports as pending. */
		setPermissionRequests(requests: readonly PermissionRequest[]) {
			permissionRequests = requests;
		},
		/** A chat changed, as kilo.core announces it. */
		update(next: ChatSummary) {
			const current = provider!.state;
			const before = current.chats[next.id];
			provider!.setState({ ...current, chats: { ...current.chats, [next.id]: next } });
			if (before) provider!.emit("updated", { before, after: next });
			else provider!.emit("created", { chat: next });
		},
		get events() {
			return provider!;
		},
	};
}

// --- Host primitives ---

/** kernel/notifications as the desktop host provides it, recording what was shown. */
export function fakeNotifications(main: MainKernel) {
	const shown =
		vi.fn<
			(input: { title: string; body?: string | undefined; silent?: boolean | undefined }) => void
		>();
	main.kernelSdk.domainObjects.provide(KernelNotifications, {
		initialState: {},
		methods: {
			show: (input) => {
				shown(input);
				return { delivered: true };
			},
			setBadge: () => undefined,
		},
	});
	return shown;
}

/**
 * A telemetry sink, so a test sees the events sent (by declared `name`).
 * Consent is granted in `beforeRender` with {@link grantDataCollection}.
 */
export function telemetrySink() {
	const delivered: Pick<TelemetryEnvelope, "key" | "name" | "data">[] = [];
	const plugin: GuestPlugin = {
		manifest: testManifest("test.telemetry-sink", {
			contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
		}),
		main: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: ({ key, name, data }) => void delivered.push({ key, name, data }),
				});
			},
		}),
	};
	return {
		plugin,
		delivered,
		/** The data of every delivered event with this key (`kilo.work-sessions/<id>`). */
		events: (id: string) =>
			delivered
				.filter(({ key }) => key === `${WORK_SESSIONS_PLUGIN_ID}/${id}`)
				.map(({ data }) => data),
	};
}

/** Lets telemetry flow (the person agreed to data collection). */
export function grantDataCollection(main: MainKernel): void {
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "test" },
		methods: { setChoice: () => {} },
	});
}

// --- Pane kinds ---

export interface TestPaneKind {
	/** The contribution id; the kind's key is `<plugin>/<id>`. */
	readonly id: string;
	/** Manifest metadata; `title` defaults to the id. */
	readonly metadata?: Partial<Omit<PaneKindMetadata, "launch">> & {
		readonly launch?: Partial<PaneKindMetadata["launch"]>;
	};
	/** Leave out to contribute the kind without code in the window (listed, not addable). */
	readonly component?: ComponentType<PaneProps>;
	readonly icon?: PaneImplementation["icon"];
	readonly canClose?: PaneImplementation["canClose"];
	readonly prefetch?: PaneImplementation["prefetch"];
}

/** A test plugin contributing pane kinds (`kilo.work-sessions/pane-kind`). */
export function paneKindPlugin(
	pluginId: string,
	kinds: readonly TestPaneKind[],
	extra: { extensions?: Record<string, unknown[]>; activate?: (sdk: PluginSdk) => void } = {},
): GuestPlugin {
	return {
		manifest: testManifest(pluginId, {
			contributes: {
				extensions: {
					"kilo.work-sessions/pane-kind": kinds.map((kind) => ({
						id: kind.id,
						title: kind.metadata?.title ?? kind.id,
						...kind.metadata,
					})),
					...extra.extensions,
				},
			},
		}),
		web: definePlugin({
			activate(sdk) {
				for (const kind of kinds) {
					if (!kind.component) continue;
					sdk.extensions.implement(PaneKind, kind.id, {
						component: kind.component,
						...(kind.icon ? { icon: kind.icon } : {}),
						...(kind.canClose ? { canClose: kind.canClose } : {}),
						...(kind.prefetch ? { prefetch: kind.prefetch } : {}),
					});
				}
				extra.activate?.(sdk);
			},
		}),
	};
}

// --- The host ---

/** kilo.work-sessions' web areas, composed as `src/web/index.ts` composes them. */
/** The real web entry, as the app registers it. */
export const testWebEntry: PluginEntry = workSessionsWebEntry;

export interface RenderWorkSessionsOptions extends WorkSessionsMainState {
	/** kilo.core's chats; without them kilo.core has no chats domain object. */
	readonly chats?: readonly ChatSummary[];
	readonly guests?: readonly GuestPlugin[];
	/** localStorage seeded before the kernels start (a window's saved state). */
	readonly localStorage?: Readonly<Record<string, string>>;
	/** Opens this work session in the main window once it has rendered. */
	readonly open?: string;
	readonly beforeRender?: (main: MainKernel) => void;
	/** The host's windows: pop-outs are offered (desktop) when set. */
	readonly windows?: MainKernelHost["windows"];
	readonly desktop?: boolean;
	readonly flags?: Readonly<Record<string, FlagValue>>;
	/** Replaces kilo.work-sessions' web entry (e.g. to boot only some areas). */
	readonly web?: PluginEntry;
}

/**
 * Boots kilo.shell and kilo.work-sessions (the fake main, the real web
 * entry) around `guests` and renders the main window.
 */
export async function renderWorkSessions(options: RenderWorkSessionsOptions = {}) {
	const main = fakeWorkSessionsMain(options);
	const chats = options.chats ? fakeChats(options.chats) : undefined;
	const storage: Record<string, string> = { ...options.localStorage };
	const host = await renderShell(
		[
			{
				manifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				main: main.entry,
				web: options.web ?? testWebEntry,
			},
			...(options.guests ?? []),
		],
		{
			core: (sdk) => {
				sdk.context.set("termsAccepted", true);
				chats?.activate(sdk);
			},
			// Seeded before the kernels start, so the window reads it at activation.
			localAppearance: storage,
			...(options.beforeRender ? { beforeRender: options.beforeRender } : {}),
			...(options.windows || options.desktop ? { desktop: true } : {}),
			...(options.windows ? { windows: options.windows } : {}),
			...(options.flags ? { flags: options.flags } : {}),
		},
	);
	const run = (command: string, args?: unknown) =>
		host.renderer.commands.execute(`${WORK_SESSIONS_PLUGIN_ID}/${command}`, args);
	const window = () => host.renderer.kernelSdk.domainObjects.get(WorkSessionsWindow)!;
	const panesState = (workSessionId: string) =>
		main.panes().state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
	if (options.open) await window().methods.openWorkSession({ workSessionId: options.open });
	return {
		host,
		run,
		window,
		main,
		panesState,
		calls: main.calls,
		chats,
		/** Aliases of `main` for list tests. */
		workSessions: main,
		workspaces: { setActive: main.calls.setActiveWorkspace },
	};
}
