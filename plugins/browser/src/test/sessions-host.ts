// Stand-ins for the plugins kilo.browser works with, for main and window
// tests: kilo.sessions (sessions and panes in memory, its openers resolved
// as main resolves them: first matching contribution by priority, the
// object's pane reused), kilo.workspaces (authorize answered by the test),
// kilo.agent's tool point and a kilo.files-like opener at -100.
import {
	definePlugin,
	KernelError,
	type DomainProvider,
	type PluginEntry,
	type PluginRegistration,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import { AgentTool } from "@kilo-desktop/plugin-agent/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_SESSION_PANES,
	PaneKind,
	PaneOpener,
	Panes,
	Sessions,
	SESSIONS_DEFINITIONS,
	type OpenPaneInput,
	type Pane,
	type Session,
	type SessionPanes,
} from "@kilo-desktop/plugin-sessions/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import { Workspaces, WORKSPACES_DEFINITIONS } from "@kilo-desktop/plugin-workspaces/contracts";

import { BROWSER_PANE_KIND } from "../contracts/index.js";

export const SESSION_ID = "wses_1";

export function session(id = SESSION_ID): Session {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: null,
		worktreeBranch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

export function browserPane(id: string, metadata: Record<string, string> = {}): Pane {
	return { id, kind: BROWSER_PANE_KIND, title: "Browser", metadata, ordinal: 1 };
}

/** `*.ext` style globs, as kilo.sessions matches them (case-insensitive, on the last segment). */
function matchesGlob(pattern: string, id: string): boolean {
	const source = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*");
	return new RegExp(`(^|/)${source}$`, "i").test(id);
}

export interface SessionsHost {
	readonly registration: PluginRegistration;
	panes(sessionId?: string): SessionPanes;
	setPanes(panes: readonly Pane[], sessionId?: string): void;
	close(paneId: string, sessionId?: string): Promise<void>;
	deleteSession(sessionId?: string): void;
	readonly updates: unknown[];
}

export function createSessionsHost(initialPanes: readonly Pane[] = []): SessionsHost {
	let panes!: DomainProvider<typeof Panes>;
	let sessions!: DomainProvider<typeof Sessions>;
	let sdkRef!: PluginSdk;
	let nextId = 1;
	const updates: unknown[] = [];
	const unused = () => {
		throw new KernelError("NOT_FOUND", "Not faked here.");
	};
	const of = (sessionId: string) => panes.state.bySession[sessionId] ?? EMPTY_SESSION_PANES;
	const write = (sessionId: string, next: SessionPanes) =>
		panes.setState({ bySession: { ...panes.state.bySession, [sessionId]: next } });
	const requirePane = (sessionId: string, paneId: string) => {
		const pane = of(sessionId).panes.find((candidate) => candidate.id === paneId);
		if (!pane) throw new KernelError("NOT_FOUND", "Pane not found.");
		return pane;
	};

	function open(input: OpenPaneInput): Pane {
		const current = of(input.sessionId);
		const existing = input.paneId
			? current.panes.find((pane) => pane.id === input.paneId)
			: undefined;
		if (existing) {
			const updated = { ...existing, metadata: input.metadata ?? existing.metadata };
			write(input.sessionId, {
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
			metadata: input.metadata ?? {},
			ordinal: 1,
		};
		write(input.sessionId, { ...current, panes: [...current.panes, pane], activePaneId: pane.id });
		panes.emit("opened", { sessionId: input.sessionId, pane });
		return pane;
	}

	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			sdkRef = sdk;
			sessions = sdk.domains.provide(Sessions, {
				initialState: { sessions: [session()] },
				methods: {
					create: unused,
					rename: unused,
					setPinned: unused,
					setArchived: unused,
					setWorktreeBranch: unused,
					remove: unused,
					isolationOptions: () => null,
					importLegacyPins: unused,
				},
			});
			panes = sdk.domains.provide(Panes, {
				initialState: {
					bySession: { [SESSION_ID]: { ...EMPTY_SESSION_PANES, panes: [...initialPanes] } },
				},
				methods: {
					open,
					openObject: ({ sessionId, ref }) => {
						const opener = sdk.extensions
							.list(PaneOpener)
							.find(
								({ metadata }) =>
									metadata.match.type === ref.type &&
									(!metadata.match.pattern || matchesGlob(metadata.match.pattern, ref.id)),
							);
						if (!opener) return null;
						const already = of(sessionId).panes.find(
							(pane) =>
								pane.kind === opener.metadata.pane &&
								pane.metadata.objectType === ref.type &&
								pane.metadata.objectId === ref.id,
						);
						return open({
							sessionId,
							kind: opener.metadata.pane,
							...(already ? { paneId: already.id } : {}),
							metadata: { ...already?.metadata, objectType: ref.type, objectId: ref.id },
						});
					},
					activate: ({ sessionId, paneId }) => {
						requirePane(sessionId, paneId);
						write(sessionId, { ...of(sessionId), activePaneId: paneId });
					},
					update: (input) => {
						updates.push(input);
						const { sessionId, paneId, title, iconKey, metadata } = input;
						const current = of(sessionId);
						const pane = requirePane(sessionId, paneId);
						const updated: Pane = {
							...pane,
							...(title ? { title } : {}),
							...(iconKey ? { iconKey } : {}),
							...(metadata ? { metadata } : {}),
						};
						write(sessionId, {
							...current,
							panes: current.panes.map((candidate) =>
								candidate.id === paneId ? updated : candidate,
							),
						});
						return updated;
					},
					close: ({ sessionId, paneId }) => {
						const current = of(sessionId);
						const pane = current.panes.find((candidate) => candidate.id === paneId);
						if (!pane) return { closed: false };
						write(sessionId, {
							...current,
							panes: current.panes.filter((candidate) => candidate.id !== paneId),
						});
						panes.emit("closed", { sessionId, pane });
						return { closed: true };
					},
					setLayout: unused,
					setArrangement: unused,
					importLegacy: unused,
				},
			});
		},
	});

	return {
		registration: { manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, entry },
		panes: (sessionId = SESSION_ID) => of(sessionId),
		setPanes: (next, sessionId = SESSION_ID) =>
			write(sessionId, { ...of(sessionId), panes: [...next] }),
		close: async (paneId, sessionId = SESSION_ID) => {
			await sdkRef.domains.get(Panes)!.methods.close({ sessionId, paneId });
		},
		deleteSession: (sessionId = SESSION_ID) => {
			sessions.setState({ sessions: [] });
			sessions.emit("deleted", { session: session(sessionId) });
		},
		updates,
	};
}

/** kilo.workspaces answering `authorize` with the test's function. */
export function workspacesRegistration(
	authorize: (input: { path: string; rule: string }) => boolean | Promise<boolean>,
): PluginRegistration {
	const unused = () => {
		throw new KernelError("NOT_FOUND", "Not faked here.");
	};
	return {
		manifest: workspacesManifest,
		definitions: WORKSPACES_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.domains.provide(Workspaces, {
					initialState: { workspaces: [], activeId: null, unavailableFolderIds: [] },
					methods: {
						create: unused,
						update: unused,
						remove: unused,
						setActive: unused,
						authorize: async (input) => ({ allowed: await authorize(input) }),
						checkFolders: () => undefined,
					},
				});
			},
		}),
	};
}

/** kilo.agent's tool point, without the gateway. */
export const agentToolPoint = testPlugin("kilo.agent", {
	manifest: { extensionPoints: [{ id: "tool", kind: "additive" }] },
	definitions: { extensionPoints: [AgentTool] },
});

/** A kilo.files-like plugin: every workspace file opens in its pane kind, at priority -100. */
export const filesOpener = testPlugin("kilo.files", {
	manifest: {
		requires: { "kilo.sessions/pane": "optional", "kilo.sessions/opener": "optional" },
		contributes: {
			extensions: {
				"kilo.sessions/pane": [{ id: "files", title: "Files" }],
				"kilo.sessions/opener": [
					{
						id: "file",
						match: { type: "kilo.workspaces/file" },
						pane: "kilo.files/files",
						priority: -100,
					},
				],
			},
		},
	},
});
