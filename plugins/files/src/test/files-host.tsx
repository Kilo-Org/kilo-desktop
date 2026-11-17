// Test host for kilo.files' web entry: main and a window linked in memory,
// with stand-ins (their real manifests and contracts) for kilo.work-sessions
// (workspaces, file changes, the `hasVcs` key, work sessions, panes, their
// openers reduced to "files open here, notebooks in a notebook pane", and the
// window's `window` object), kilo.shell's theme, a telemetry sink with
// consent, and kilo.files' `documents` in
// main faked from the test's methods. kilo.core and kilo.chat are present for
// their manifests. Panes render as kilo.work-sessions' canvas renders them,
// from the Panes state.
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	definePlugin,
	KernelDataCollection,
	KernelError,
	KernelTelemetrySink,
	type DomainObjectHandle,
	type DomainObjectProvider,
	type DomainObjectState,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestHost, createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution, useDomainObjectState } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS, Theme } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	FileWatcher,
	PaneKind,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type FileChange,
	type Pane,
	type PaneImplementation,
	type PaneProps,
	type WorkSession,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { Toaster } from "@kilo-desktop/ui/components/sonner";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { Documents, FILES_DEFINITIONS } from "../contracts/index.js";
import { basename, FILE_OBJECT_TYPE, FILES_PANE_KIND } from "../contracts/panes.js";
import type { DocumentMethods } from "../web/documents.js";
import { filesWebEntry } from "../web/index.js";

export const WORK_SESSION_ID = "wses_1";
export const NOTEBOOK_PANE_KIND = "kilo.notebook/notebook";

type ThemeState = DomainObjectState<typeof Theme>;
type UpdateInput = Parameters<DomainObjectHandle<typeof Panes>["methods"]["update"]>[0];

/** A telemetry event as a sink received it: its declared name and data. */
export interface TrackedEvent {
	readonly event: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export interface Folder {
	readonly path: string;
	readonly isPrimary: boolean;
}

export interface FilesHostOptions {
	/** kilo.files' `documents` in main; a missing method rejects NOT_FOUND. */
	readonly documents?: Partial<DocumentMethods>;
	/** The work session's workspace folders; empty for a work session without a workspace. */
	readonly folders?: readonly Folder[];
	/** The work session's copy, standing in for the primary folder. */
	readonly directory?: string | null;
	readonly panes?: readonly Pane[];
	readonly activePaneId?: string | null;
	readonly theme?: ThemeState;
	/** Whether `.ipynb` objects open in a notebook pane (else in Files, as without kilo.notebook). */
	readonly notebookOpener?: boolean;
	/** `openObject` rejects with this message. */
	readonly openFails?: string;
	/** What `WorkSessionsWindow.openPane` does; by default it opens the pane in the work session. */
	readonly openPane?: (input: { kind: string }) => void;
	readonly main?: readonly PluginRegistration[];
	readonly renderer?: readonly PluginRegistration[];
}

export function filesPane(
	id: string,
	metadata: Record<string, string> = {},
	title = "Files",
): Pane {
	return { id, kind: FILES_PANE_KIND, title, metadata, ordinal: 1 };
}

/** A Files pane showing the file at `path`, as `Panes.openObject` opens it. */
export function openedFilePane(id: string, path: string): Pane {
	return { ...filesPane(id, {}, basename(path)), object: { type: FILE_OBJECT_TYPE, id: path } };
}

function workSession(directory: string | null, workspaceId: string | null): WorkSession {
	return {
		id: WORK_SESSION_ID,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId,
		branch: directory ? "kilo/work" : null,
		directory,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

/** Boots the host; render something with `host.render`. */
export async function bootFilesHost(options: FilesHostOptions = {}) {
	cleanup();
	const folders = options.folders ?? [{ path: "/workspace", isPrimary: true }];
	let currentFolders = folders;
	const workspaceId = folders.length > 0 ? "w1" : null;
	const openedObjects: { workSessionId: string; ref: { type: string; id: string } }[] = [];
	const updates: UpdateInput[] = [];
	const tracked: TrackedEvent[] = [];
	let files!: DomainObjectProvider<typeof FileWatcher>;
	let panes!: DomainObjectProvider<typeof Panes>;
	let workspaces!: DomainObjectProvider<typeof Workspaces>;
	let theme: DomainObjectProvider<typeof Theme> | undefined;
	let nextPane = 1;
	const unused = (name: string) => () => {
		throw new KernelError("NOT_FOUND", `${name} is not faked here.`);
	};

	const current = () => panes.state.byWorkSession[WORK_SESSION_ID] ?? EMPTY_WORK_SESSION_PANES;
	const setSessionPanes = (patch: Partial<typeof EMPTY_WORK_SESSION_PANES>) =>
		panes.setState({
			byWorkSession: {
				...panes.state.byWorkSession,
				[WORK_SESSION_ID]: { ...current(), ...patch },
			},
		});
	const upsert = (pane: Pane, activate = true) => {
		const others = current().panes.filter((candidate) => candidate.id !== pane.id);
		setSessionPanes({ panes: [...others, pane], ...(activate ? { activePaneId: pane.id } : {}) });
		return pane;
	};

	const workSessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			workspaces = sdk.domainObjects.provide(Workspaces, {
				initialState: {
					workspaces:
						folders.length > 0
							? [
									{
										id: "w1",
										name: "Workspace",
										folders: folders.map((folder, position) => ({
											id: `f${position}`,
											position,
											...folder,
										})),
										createdAt: 0,
										updatedAt: 0,
									},
								]
							: [],
					activeId: workspaceId,
					unavailableFolderIds: [],
				},
				methods: {
					create: unused("create"),
					update: unused("update"),
					remove: unused("remove"),
					setActive: unused("setActive"),
					authorize: () => ({ allowed: true }),
					checkFolders: () => undefined,
				},
			});
			files = sdk.domainObjects.provide(FileWatcher, {
				initialState: { watched: [] },
				methods: {},
			});
			sdk.context.set("hasVcs", true);
			sdk.domainObjects.provide(WorkSessions, {
				initialState: {
					workSessions: [workSession(options.directory ?? null, workspaceId)],
				},
				methods: {
					create: unused("create"),
					createChat: unused("createChat"),
					rename: unused("rename"),
					setPinned: unused("setPinned"),
					setArchived: unused("setArchived"),
					setBranch: unused("setBranch"),
					remove: unused("remove"),
					isolationOptions: () => null,
				},
			});
			panes = sdk.domainObjects.provide(Panes, {
				initialState: {
					byWorkSession: {
						[WORK_SESSION_ID]: {
							...EMPTY_WORK_SESSION_PANES,
							panes: [...(options.panes ?? [])],
							activePaneId: options.activePaneId ?? options.panes?.[0]?.id ?? null,
						},
					},
				},
				methods: {
					open: (input) =>
						upsert({
							id: `opened-${nextPane++}`,
							kind: input.kind,
							title: input.title ?? "Files",
							metadata: input.metadata ?? {},
							ordinal: 1,
						}),
					openObject: ({ workSessionId, ref }) => {
						openedObjects.push({ workSessionId, ref });
						if (options.openFails) throw new KernelError("BUSINESS", options.openFails);
						if (ref.type !== FILE_OBJECT_TYPE) return null;
						const notebook = options.notebookOpener && ref.id.endsWith(".ipynb");
						const kind = notebook ? NOTEBOOK_PANE_KIND : FILES_PANE_KIND;
						const existing = current().panes.find(
							(pane) =>
								pane.kind === kind && pane.object?.type === ref.type && pane.object.id === ref.id,
						);
						const pane: Pane = existing ?? {
							id: `opened-${nextPane++}`,
							kind,
							title: notebook ? "Notebook" : basename(ref.id),
							object: ref,
							metadata: {},
							ordinal: 1,
						};
						const opened = upsert(pane);
						panes.emit("opened", { workSessionId, pane: opened });
						return opened;
					},
					activate: ({ paneId }) => void setSessionPanes({ activePaneId: paneId }),
					update: (input) => {
						updates.push(input);
						const pane = current().panes.find((candidate) => candidate.id === input.paneId);
						if (!pane) throw new KernelError("NOT_FOUND", "Pane not found.");
						return upsert(
							{
								...pane,
								...(input.title === undefined ? {} : { title: input.title }),
								...(input.iconKey === undefined ? {} : { iconKey: input.iconKey }),
								...(input.metadata ? { metadata: input.metadata } : {}),
							},
							false,
						);
					},
					close: ({ paneId }) => {
						const closing = current().panes.some((pane) => pane.id === paneId);
						setSessionPanes({ panes: current().panes.filter((pane) => pane.id !== paneId) });
						return { closed: closing };
					},
					setLayout: () => undefined,
					setArrangement: () => undefined,
				},
			});
		},
	});

	const documentsMain: PluginEntry = definePlugin({
		activate(sdk) {
			const fake = options.documents ?? {};
			sdk.domainObjects.provide(Documents, {
				initialState: {},
				methods: new Proxy({} as Record<string, (input: unknown) => unknown>, {
					get: (_target, key: string) => (input: unknown) => {
						const method = fake[key as keyof DocumentMethods] as
							| ((input: unknown) => unknown)
							| undefined;
						if (!method) throw new KernelError("NOT_FOUND", `${key} is not faked here.`);
						return Promise.resolve()
							.then(() => method(input))
							.catch((error: unknown) => {
								throw error instanceof KernelError
									? error
									: new KernelError(
											"BUSINESS",
											error instanceof Error ? error.message : "The file operation failed.",
										);
							});
					},
				}) as never,
			});
		},
	});

	const telemetrySink = testPlugin("test.telemetry-sink", {
		manifest: { contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } } },
		entry: {
			activate: (sdk) => {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: ({ name, data }) => void tracked.push({ event: name, data }),
				});
			},
		},
	});

	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			if (options.theme) {
				theme = sdk.domainObjects.provide(Theme, { initialState: options.theme, methods: {} });
			}
		},
	});

	const workSessionsWeb: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(WorkSessionsWindow, {
				initialState: {
					focus: null,
					activeWorkSessionId: WORK_SESSION_ID,
					view: null,
					detachedViews: [],
				},
				methods: {
					setFocus: () => undefined,
					openWorkSession: () => undefined,
					closeWorkSession: () => undefined,
					showView: () => undefined,
					openPane: async (input) => {
						if (options.openPane) return options.openPane(input);
						await sdk.domainObjects
							.get(Panes)
							?.methods.open({ workSessionId: WORK_SESSION_ID, kind: input.kind });
					},
				},
			});
			sdk.context.set("workSessionActive", true);
			sdk.context.set("paneTargetActive", true);
		},
	});

	const { main, renderer } = await createTestKernelPair({
		host: createTestHost(),
		main: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
			{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessionsMain,
			},
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{ manifest, definitions: FILES_DEFINITIONS, entry: documentsMain },
			telemetrySink,
			...(options.main ?? []),
		],
		renderer: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
			{ manifest: shellManifest, definitions: SHELL_DEFINITIONS, entry: shellWeb },
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessionsWeb,
			},
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{ manifest, definitions: FILES_DEFINITIONS, entry: filesWebEntry },
			...(options.renderer ?? []),
		],
	});
	main.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: true, allowed: true, installationId: "i", environment: "test" },
		methods: { setChoice: () => {} },
	});
	await main.flush();

	const wrap = (element: ReactNode) => (
		<KernelProvider kernel={renderer}>
			<TooltipProvider>{element}</TooltipProvider>
			<Toaster />
		</KernelProvider>
	);

	return {
		main,
		renderer,
		/** The work session's folders now. */
		folders: () => currentFolders,
		directory: options.directory ?? null,
		/** `Panes.openObject` calls, in order. */
		openedObjects,
		/** `Panes.update` calls, in order. */
		updates,
		/** Telemetry events sent. */
		tracked,
		sessionPanes: current,
		pane: (paneId: string) => current().panes.find((pane) => pane.id === paneId),
		/** Adds or replaces a pane, as another window or an opener would. */
		setPane: (pane: Pane) =>
			act(async () => {
				upsert(pane);
				await main.flush();
			}),
		activate: (paneId: string | null) =>
			act(async () => {
				setSessionPanes({ activePaneId: paneId });
				await main.flush();
			}),
		/** One `kilo.work-sessions/file-watcher` change batch, delivered to the window. */
		emitFileChanges: (root: string, changes: readonly FileChange[]) =>
			act(async () => {
				files.emit("changed", { root, changes: [...changes] });
				await main.flush();
			}),
		setFolders: (next: readonly Folder[]) =>
			act(async () => {
				currentFolders = next;
				const [first] = workspaces.state.workspaces;
				if (!first) return;
				workspaces.setState({
					...workspaces.state,
					workspaces: [
						{
							...first,
							folders: next.map((folder, position) => ({
								id: `f${position}`,
								position,
								...folder,
							})),
						},
					],
				});
				await main.flush();
			}),
		setTheme: (next: ThemeState) => act(() => theme?.setState(next)),
		flush: () => act(() => main.flush()),
		wrap,
		render: (element: ReactNode) => render(wrap(element)),
	};
}

export type FilesHost = Awaited<ReturnType<typeof bootFilesHost>>;

const selectComponent = (implementation: PaneImplementation) => implementation.component;

/** One pane of the session as kilo.work-sessions' canvas renders it: its kind's component, from the Panes state. */
export function PaneHost({ host, paneId }: { readonly host: FilesHost; readonly paneId: string }) {
	const pane = useDomainObjectState(Panes, (state: DomainObjectState<typeof Panes>) =>
		state.byWorkSession[WORK_SESSION_ID]?.panes.find((candidate) => candidate.id === paneId),
	);
	const kind = host.renderer.extensions
		.list(PaneKind)
		.find((candidate) => candidate.key === (pane?.kind ?? FILES_PANE_KIND));
	if (!pane || !kind) return null;
	const props: PaneProps = {
		workSessionId: WORK_SESSION_ID,
		pane,
		workspaceId: host.folders().length > 0 ? "w1" : null,
		directory: host.directory ?? host.folders().find((folder) => folder.isPrimary)?.path ?? null,
		visible: true,
	};
	return (
		<RenderContribution
			key={`${WORK_SESSION_ID}:${pane.id}`}
			contribution={kind}
			props={props}
			select={selectComponent}
		/>
	);
}

/** The Files pane kind's implementation in the window. */
export function filesPaneKind(host: FilesHost): PaneImplementation {
	return host.renderer.extensions.list(PaneKind).find((kind) => kind.key === FILES_PANE_KIND)!
		.implementation as PaneImplementation;
}
