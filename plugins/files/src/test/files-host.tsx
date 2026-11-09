// Test host for kilo.files' web entry: main and a window linked in memory,
// with stand-ins for kilo.workspaces (folders, file changes), kilo.sessions
// (sessions and panes, its openers reduced to "files open here, notebooks in
// a notebook pane"), kilo.telemetry, kilo.flags and kilo.shell's theme, and
// kilo.files' `documents` in main faked from the test's methods. Panes render
// as kilo.workbench's canvas renders them, from the Panes state.
import { act, cleanup, render } from "@testing-library/react";
import { useCallback, type ReactNode } from "react";

import {
	definePlugin,
	KernelError,
	type DomainHandle,
	type DomainProvider,
	type DomainState,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution, useDomainState } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import flagsManifest from "@kilo-desktop/plugin-flags/plugin.json";
import { FLAGS_DEFINITIONS } from "@kilo-desktop/plugin-flags/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	WorkSessions,
	SESSIONS_DEFINITIONS,
	type Pane,
	type PaneImplementation,
	type PaneProps,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DOMAINS, SHELL_EXTENSION_POINTS, Theme } from "@kilo-desktop/plugin-shell/contracts";
import telemetryManifest from "@kilo-desktop/plugin-telemetry/plugin.json";
import {
	Telemetry,
	TELEMETRY_DEFINITIONS,
	type TrackInput,
} from "@kilo-desktop/plugin-telemetry/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Files,
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type FileChange,
} from "@kilo-desktop/plugin-workspaces/contracts";
import { Toaster } from "@kilo-desktop/ui/components/sonner";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { Documents, FILES_DEFINITIONS } from "../contracts/index.js";
import {
	basename,
	FILE_OBJECT_TYPE,
	FILE_PANE_METADATA,
	FILES_PANE_KIND,
} from "../contracts/panes.js";
import type { DocumentMethods } from "../web/documents.js";
import { filesWebEntry } from "../web/index.js";

export const SESSION_ID = "session-1";
export const NOTEBOOK_PANE_KIND = "kilo.notebook/notebook";

type ThemeState = DomainState<typeof Theme>;
type UpdateInput = Parameters<DomainHandle<typeof Panes>["methods"]["update"]>[0];

export interface Folder {
	readonly path: string;
	readonly isPrimary: boolean;
}

export interface FilesHostOptions {
	/** kilo.files' `documents` in main; a missing method rejects NOT_FOUND. */
	readonly documents?: Partial<DocumentMethods>;
	/** The session's workspace folders; empty for a session without a workspace. */
	readonly folders?: readonly Folder[];
	/** The session's worktree, standing in for the primary folder. */
	readonly directory?: string | null;
	readonly panes?: readonly Pane[];
	readonly activePaneId?: string | null;
	/** Flags turned on (kilo.flags' `flag:` context keys). */
	readonly flags?: readonly string[];
	readonly theme?: ThemeState;
	/** Whether `.ipynb` objects open in a notebook pane (else in Files, as without kilo.notebook). */
	readonly notebookOpener?: boolean;
	/** `openObject` rejects with this message. */
	readonly openFails?: string;
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

function session(directory: string | null, workspaceId: string | null): WorkSession {
	return {
		id: SESSION_ID,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId,
		worktreeBranch: directory ? "kilo/work" : null,
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
	const openedObjects: { sessionId: string; ref: { type: string; id: string } }[] = [];
	const updates: UpdateInput[] = [];
	const tracked: TrackInput[] = [];
	let files!: DomainProvider<typeof Files>;
	let panes!: DomainProvider<typeof Panes>;
	let workspaces!: DomainProvider<typeof Workspaces>;
	let theme: DomainProvider<typeof Theme> | undefined;
	let nextPane = 1;
	const unused = (name: string) => () => {
		throw new KernelError("NOT_FOUND", `${name} is not faked here.`);
	};

	const current = () => panes.state.bySession[SESSION_ID] ?? EMPTY_WORK_SESSION_PANES;
	const setSessionPanes = (patch: Partial<typeof EMPTY_WORK_SESSION_PANES>) =>
		panes.setState({
			bySession: { ...panes.state.bySession, [SESSION_ID]: { ...current(), ...patch } },
		});
	const upsert = (pane: Pane, activate = true) => {
		const others = current().panes.filter((candidate) => candidate.id !== pane.id);
		setSessionPanes({ panes: [...others, pane], ...(activate ? { activePaneId: pane.id } : {}) });
		return pane;
	};

	const workspacesMain: PluginEntry = definePlugin({
		activate(sdk) {
			workspaces = sdk.domains.provide(Workspaces, {
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
			files = sdk.domains.provide(Files, { initialState: { watched: [] }, methods: {} });
		},
	});

	const sessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(WorkSessions, {
				initialState: { sessions: [session(options.directory ?? null, workspaceId)] },
				methods: {
					create: unused("create"),
					rename: unused("rename"),
					setPinned: unused("setPinned"),
					setArchived: unused("setArchived"),
					setWorktreeBranch: unused("setWorktreeBranch"),
					remove: unused("remove"),
					importLegacyPins: unused("importLegacyPins"),
					isolationOptions: () => null,
				},
			});
			panes = sdk.domains.provide(Panes, {
				initialState: {
					bySession: {
						[SESSION_ID]: {
							...EMPTY_WORK_SESSION_PANES,
							panes: [...(options.panes ?? [])],
							activePaneId: options.activePaneId ?? options.panes?.[0]?.id ?? null,
						},
					},
				},
				methods: {
					open: unused("open"),
					openObject: ({ sessionId, ref }) => {
						openedObjects.push({ sessionId, ref });
						if (options.openFails) throw new KernelError("BUSINESS", options.openFails);
						if (ref.type !== FILE_OBJECT_TYPE) return null;
						const notebook = options.notebookOpener && ref.id.endsWith(".ipynb");
						const kind = notebook ? NOTEBOOK_PANE_KIND : FILES_PANE_KIND;
						const existing = current().panes.find(
							(pane) =>
								pane.kind === kind &&
								pane.metadata[FILE_PANE_METADATA.objectType] === ref.type &&
								pane.metadata[FILE_PANE_METADATA.objectId] === ref.id,
						);
						const pane: Pane = existing ?? {
							id: `opened-${nextPane++}`,
							kind,
							title: notebook ? "Notebook" : basename(ref.id),
							metadata: {
								[FILE_PANE_METADATA.objectType]: ref.type,
								[FILE_PANE_METADATA.objectId]: ref.id,
							},
							ordinal: 1,
						};
						const opened = upsert(pane);
						panes.emit("opened", { sessionId, pane: opened });
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
					importLegacy: () => undefined,
				},
			});
		},
	});

	const documentsMain: PluginEntry = definePlugin({
		activate(sdk) {
			const fake = options.documents ?? {};
			sdk.domains.provide(Documents, {
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

	const telemetryMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(Telemetry, {
				initialState: {},
				methods: { track: (input) => void tracked.push(input) },
			});
		},
	});

	const flagsMain: PluginEntry = definePlugin({
		activate(sdk) {
			for (const flag of options.flags ?? []) sdk.context.set(`flag:${flag}`, true);
		},
	});

	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			if (options.theme) {
				theme = sdk.domains.provide(Theme, { initialState: options.theme, methods: {} });
			}
		},
	});

	const shell = {
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	};
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS, entry: workspacesMain },
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, entry: sessionsMain },
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS, entry: telemetryMain },
			{ manifest: flagsManifest, definitions: FLAGS_DEFINITIONS, entry: flagsMain },
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{ manifest, definitions: FILES_DEFINITIONS, entry: documentsMain },
			...(options.main ?? []),
		],
		renderer: [
			{ ...shell, entry: shellWeb },
			{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS },
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS },
			{ manifest: telemetryManifest, definitions: TELEMETRY_DEFINITIONS },
			{ manifest: flagsManifest, definitions: FLAGS_DEFINITIONS },
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{ manifest, definitions: FILES_DEFINITIONS, entry: filesWebEntry },
			...(options.renderer ?? []),
		],
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
		/** The session's folders now. */
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
		/** One kilo.workspaces file-change batch, delivered to the window. */
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

/** One pane of the session as kilo.workbench's canvas renders it: its kind's component, from the Panes state. */
export function PaneHost({ host, paneId }: { readonly host: FilesHost; readonly paneId: string }) {
	const pane = useDomainState(
		Panes,
		useCallback(
			(state: DomainState<typeof Panes>) =>
				state.bySession[SESSION_ID]?.panes.find((candidate) => candidate.id === paneId),
			[paneId],
		),
	);
	const kind = host.renderer.extensions
		.list(PaneKind)
		.find((candidate) => candidate.key === (pane?.kind ?? FILES_PANE_KIND));
	if (!pane || !kind) return null;
	const props: PaneProps = {
		sessionId: SESSION_ID,
		pane,
		workspaceId: host.folders().length > 0 ? "w1" : null,
		directory: host.directory ?? host.folders().find((folder) => folder.isPrimary)?.path ?? null,
		visible: true,
	};
	return (
		<RenderContribution
			key={`${SESSION_ID}:${pane.id}`}
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
