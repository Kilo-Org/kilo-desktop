// Stand-ins for the plugins kilo.notebook works with, for main and window
// tests, under their real manifests and definitions: kilo.work-sessions (work
// sessions and panes in memory, its openers resolved as main resolves them:
// first matching contribution by priority, the object's pane reused),
// kilo.core's points (tool, agent-extension, server-env) and a kilo.files-like
// opener at -100.
import {
	definePlugin,
	KernelError,
	type DomainObjectProvider,
	type PluginEntry,
	type PluginRegistration,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	Opener,
	PaneKind,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	type OpenPaneInput,
	type Pane,
	type WorkSession,
	type WorkSessionPanes,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { FILE_OBJECT_TYPE, NOTEBOOK_PANE_KIND } from "../contracts/index.js";

export const SESSION_ID = "wses_1";

export function session(id = SESSION_ID): WorkSession {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: null,
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

/** A Notebook pane; `object` is the file it was opened for (a `kilo.work-sessions/file` ref). */
export function notebookPane(
	id: string,
	metadata: Record<string, string> = {},
	object?: Pane["object"],
): Pane {
	return {
		id,
		kind: NOTEBOOK_PANE_KIND,
		title: "Notebook",
		...(object ? { object } : {}),
		metadata,
		ordinal: 1,
	};
}

/** `*.ext` style globs, as kilo.work-sessions matches them (case-insensitive, on the last segment). */
function matchesGlob(pattern: string, id: string): boolean {
	const source = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*");
	return new RegExp(`(^|/)${source}$`, "i").test(id);
}

export interface SessionsHost {
	readonly registration: PluginRegistration;
	panes(workSessionId?: string): WorkSessionPanes;
	setPanes(panes: readonly Pane[], workSessionId?: string): void;
	close(paneId: string, workSessionId?: string): Promise<void>;
	deleteSession(workSessionId?: string): void;
	readonly updates: unknown[];
}

export function createSessionsHost(initialPanes: readonly Pane[] = []): SessionsHost {
	let panes!: DomainObjectProvider<typeof Panes>;
	let workSessions!: DomainObjectProvider<typeof WorkSessions>;
	let sdkRef!: PluginSdk;
	let nextId = 1;
	const updates: unknown[] = [];
	const unused = () => {
		throw new KernelError("NOT_FOUND", "Not faked here.");
	};
	const of = (workSessionId: string) =>
		panes.state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES;
	const write = (workSessionId: string, next: WorkSessionPanes) =>
		panes.setState({ byWorkSession: { ...panes.state.byWorkSession, [workSessionId]: next } });
	const requirePane = (workSessionId: string, paneId: string) => {
		const pane = of(workSessionId).panes.find((candidate) => candidate.id === paneId);
		if (!pane) throw new KernelError("NOT_FOUND", "Pane not found.");
		return pane;
	};

	function open(input: OpenPaneInput): Pane {
		const current = of(input.workSessionId);
		const existing = input.paneId
			? current.panes.find((pane) => pane.id === input.paneId)
			: undefined;
		if (existing) {
			const updated: Pane = {
				...existing,
				...(input.object ? { object: input.object } : {}),
				metadata: input.metadata ?? existing.metadata,
			};
			write(input.workSessionId, {
				...current,
				panes: current.panes.map((pane) => (pane.id === existing.id ? updated : pane)),
				activePaneId: updated.id,
			});
			return updated;
		}
		const title = sdkRef.extensions
			.list(PaneKind)
			.find((contribution) => contribution.key === input.kind)?.metadata.title;
		const pane: Pane = {
			id: `pane_${nextId++}`,
			kind: input.kind,
			title: input.title ?? title ?? "Pane",
			...(input.object ? { object: input.object } : {}),
			metadata: input.metadata ?? {},
			ordinal: 1,
		};
		write(input.workSessionId, {
			...current,
			panes: [...current.panes, pane],
			activePaneId: pane.id,
		});
		panes.emit("opened", { workSessionId: input.workSessionId, pane });
		return pane;
	}

	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			sdkRef = sdk;
			workSessions = sdk.domainObjects.provide(WorkSessions, {
				initialState: { workSessions: [session()] },
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
			panes = sdk.domainObjects.provide(Panes, {
				initialState: {
					byWorkSession: {
						[SESSION_ID]: { ...EMPTY_WORK_SESSION_PANES, panes: [...initialPanes] },
					},
				},
				methods: {
					open,
					openObject: ({ workSessionId, ref }) => {
						const opener = sdk.extensions
							.list(Opener)
							.find(
								({ metadata }) =>
									metadata.match.type === ref.type &&
									(!metadata.match.pattern || matchesGlob(metadata.match.pattern, ref.id)),
							);
						if (!opener) return null;
						const already = of(workSessionId).panes.find(
							(pane) =>
								pane.kind === opener.metadata.pane &&
								pane.object?.type === ref.type &&
								pane.object.id === ref.id,
						);
						return open({
							workSessionId,
							kind: opener.metadata.pane,
							object: ref,
							...(already ? { paneId: already.id } : {}),
						});
					},
					activate: ({ workSessionId, paneId }) => {
						requirePane(workSessionId, paneId);
						write(workSessionId, { ...of(workSessionId), activePaneId: paneId });
					},
					update: (input) => {
						updates.push(input);
						const { workSessionId, paneId, title, iconKey, object, metadata } = input;
						const current = of(workSessionId);
						const pane = requirePane(workSessionId, paneId);
						const updated: Pane = {
							...pane,
							...(title ? { title } : {}),
							...(iconKey ? { iconKey } : {}),
							...(object ? { object } : {}),
							...(metadata ? { metadata } : {}),
						};
						write(workSessionId, {
							...current,
							panes: current.panes.map((candidate) =>
								candidate.id === paneId ? updated : candidate,
							),
						});
						return updated;
					},
					close: ({ workSessionId, paneId }) => {
						const current = of(workSessionId);
						const pane = current.panes.find((candidate) => candidate.id === paneId);
						if (!pane) return { closed: false };
						write(workSessionId, {
							...current,
							panes: current.panes.filter((candidate) => candidate.id !== paneId),
						});
						panes.emit("closed", { workSessionId, pane });
						return { closed: true };
					},
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
		panes: (workSessionId = SESSION_ID) => of(workSessionId),
		setPanes: (next, workSessionId = SESSION_ID) =>
			write(workSessionId, { ...of(workSessionId), panes: [...next] }),
		close: async (paneId, workSessionId = SESSION_ID) => {
			await sdkRef.domainObjects.get(Panes)!.methods.close({ workSessionId, paneId });
		},
		deleteSession: (workSessionId = SESSION_ID) => {
			workSessions.setState({ workSessions: [] });
			workSessions.emit("deleted", { workSession: session(workSessionId) });
		},
		updates,
	};
}

/** kilo.core's manifest and definitions, for its tool, agent-extension and server-env points (no entry: no server). */
export const coreRegistration: PluginRegistration = {
	manifest: coreManifest,
	definitions: CORE_DEFINITIONS,
};

/** A kilo.files-like plugin: every workspace file opens in its pane kind, at priority -100. */
export const filesOpener = testPlugin("kilo.files", {
	manifest: {
		requires: {
			"kilo.work-sessions/pane-kind": "optional",
			"kilo.work-sessions/opener": "optional",
		},
		contributes: {
			extensions: {
				"kilo.work-sessions/pane-kind": [{ id: "files", title: "Files" }],
				"kilo.work-sessions/opener": [
					{
						id: "file",
						match: { type: FILE_OBJECT_TYPE },
						pane: "kilo.files/files",
						priority: -100,
					},
				],
			},
		},
	},
});
