import { definePlugin, KernelError, type PluginFs } from "@kilo-desktop/kernel";
import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, KiloServer } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS, Composer } from "@kilo-desktop/plugin-chat/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import {
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	Workspaces,
	type WorkSession,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { WORKBOOKS_DEFINITIONS } from "../contracts";
import { createWorkbooksMainEntry } from "../main";
import { workbooksWebEntry } from "../web";
import { FakePages } from "./fake-pages";

export const WORKSPACE: Workspace = {
	id: "ws-1",
	name: "Kilo Desktop",
	folders: [{ id: "f-1", path: "/repo", isPrimary: true, position: 0 }],
	createdAt: 0,
	updatedAt: 0,
};

const unused = () => {
	throw new KernelError("UNAVAILABLE", "not in this test");
};

/** A work session as kilo.work-sessions holds it, in a workspace or (null) none. */
export function workSession(id: string, workspaceId: string | null = null): WorkSession {
	return {
		id,
		title: "",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId,
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
	};
}

/** Lets a test delete a work session, as kilo.work-sessions would announce it. */
export interface WorkSessionsControl {
	delete(id: string): void;
}

/** kilo.work-sessions' workspaces and work sessions, in memory, for kilo.workbooks to read. */
export function workSessionsStandIn(
	workspaces: Workspace[] = [WORKSPACE],
	control: { current?: WorkSessionsControl } = {},
	workSessions: WorkSession[] = [],
) {
	return {
		manifest: workSessionsManifest,
		definitions: WORK_SESSIONS_DEFINITIONS,
		main: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(Workspaces, {
					initialState: {
						workspaces,
						activeId: workspaces[0]?.id ?? null,
						unavailableFolderIds: [],
					},
					methods: new Proxy({}, { get: () => unused }) as never,
				});
				const sessions = sdk.domainObjects.provide(WorkSessions, {
					initialState: { workSessions },
					methods: new Proxy({}, { get: () => unused }) as never,
				});
				control.current = {
					delete: (id) => sessions.emit("deleted", { workSession: workSession(id) }),
				};
			},
		}),
	};
}

/** The New Session page's draft, as the chat stand-in's composer holds it. */
export interface NewSessionDraft {
	text: string;
}

/** kilo.chat's composer in the window: keeps the New Session draft, as `prefillNewSession` sets it. */
export function chatStandIn(draft: NewSessionDraft) {
	return {
		manifest: chatManifest,
		definitions: CHAT_DEFINITIONS,
		web: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(Composer, {
					initialState: { focusedWorkSessionId: null },
					methods: {
						focus: () => undefined,
						insert: unused,
						startChat: unused,
						prefillNewSession: ({ text, replacing }) => {
							if (draft.text.trim() && draft.text !== replacing) return false;
							draft.text = text;
							return true;
						},
					},
				});
			},
		}),
	};
}

export const shellRegistration = { manifest: shellManifest, definitions: SHELL_DEFINITIONS };

export const coreRegistration = { manifest: coreManifest, definitions: CORE_DEFINITIONS };

export const KILO_CONNECTION = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "1",
	globalDirectory: "/runtime",
};

/** kilo.core with a ready Kilo server, so kilo.workbooks reaches Pages over HTTP. */
function coreWithServer() {
	return {
		...coreRegistration,
		main: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(KiloServer, {
					initialState: { status: "ready" },
					methods: {
						connect: () => KILO_CONNECTION,
						restart: unused,
						disposeInstance: unused,
						userConfigFile: unused,
					},
				});
			},
		}),
	};
}

/** Kilo's `/experimental/mcp/call-tool`, answered by an in-memory Pages. */
function kiloFetch(pages: FakePages, directories: (string | undefined)[]): typeof fetch {
	return async (input, init) => {
		const url = new URL(String(input));
		directories.push(url.searchParams.get("directory") ?? undefined);
		const body = JSON.parse(String(init?.body)) as {
			name: string;
			arguments: Record<string, unknown>;
		};
		try {
			const result = await pages.call(body.name, body.arguments);
			return Response.json({ content: [{ type: "text", text: JSON.stringify(result) }] });
		} catch (error) {
			return Response.json({ isError: true, content: [{ type: "text", text: String(error) }] });
		}
	};
}

/** Another plugin to boot alongside kilo.workbooks. */
export type GuestPlugin = Parameters<typeof createPluginHost>[0][number];

export interface WorkbooksHost {
	readonly host: PluginHost;
	readonly pages: FakePages;
	/** The Kilo instance (by directory) each Pages call went to, when reached through Kilo. */
	readonly directories: (string | undefined)[];
	readonly fs: ReturnType<typeof memoryFs>;
}

/** kilo.workbooks with an in-memory Pages and workspaces, booted on real kernels. */
/** An in-memory stand-in for a plugin's sandboxed `sdk.fs`: paths are file keys; folders are implied. */
export function memoryFs(
	files = new Map<string, string>(),
): PluginFs & { files: Map<string, string> } {
	const missing = (path: string) => new Error(`ENOENT: ${path}`);
	const under = (path: string) => (path ? `${path.replace(/\/$/, "")}/` : "");
	return {
		files,
		readFile: async (path) => {
			const content = files.get(path);
			if (content === undefined) throw missing(path);
			return content;
		},
		writeFile: async (path, content) => void files.set(path, content),
		exists: async (path) =>
			files.has(path) || [...files.keys()].some((key) => key.startsWith(under(path))),
		mkdir: async () => undefined,
		readdir: async (path) => {
			const prefix = under(path);
			const names = [...files.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => key.slice(prefix.length).split("/")[0]!);
			if (names.length === 0) throw missing(path);
			return [...new Set(names)];
		},
		remove: async (path) => {
			for (const key of [...files.keys()]) {
				if (key === path || key.startsWith(under(path))) files.delete(key);
			}
		},
	};
}

export async function bootWorkbooks(
	options: {
		readonly pages?: FakePages;
		readonly storage?: ReturnType<typeof createMemoryStorage>;
		/** kilo.workbooks' sandboxed files (its own templates live here). */
		readonly fs?: ReturnType<typeof memoryFs>;
		readonly others?: readonly GuestPlugin[];
		/** Reach Pages the real way: through a (stand-in) Kilo server over HTTP. */
		readonly viaKilo?: boolean;
		readonly workSessions?: { current?: WorkSessionsControl };
		/** The work sessions kilo.work-sessions starts with. */
		readonly sessions?: WorkSession[];
		/** The New Session draft the chat stand-in keeps. */
		readonly draft?: NewSessionDraft;
		/** The `workbooks` flag; on unless a test turns it off. */
		readonly flag?: boolean;
	} = {},
): Promise<WorkbooksHost> {
	const pages = options.pages ?? new FakePages();
	const directories: (string | undefined)[] = [];
	const storage = options.storage ?? createMemoryStorage("/memory/kilo.workbooks");
	const fs = options.fs ?? memoryFs();
	const host = await createPluginHost(
		[
			options.viaKilo ? coreWithServer() : coreRegistration,
			workSessionsStandIn([WORKSPACE], options.workSessions, options.sessions),
			shellRegistration,
			chatStandIn(options.draft ?? { text: "" }),
			{
				manifest,
				definitions: WORKBOOKS_DEFINITIONS,
				main: createWorkbooksMainEntry(options.viaKilo ? {} : { pages: () => pages }),
				web: workbooksWebEntry,
			},
			...(options.others ?? []),
		],
		{
			host: { flagOverrides: { workbooks: options.flag ?? true } },
			mainHostServices: (pluginId) =>
				({
					storage:
						pluginId === "kilo.workbooks" ? storage : createMemoryStorage(`/memory/${pluginId}`),
					fs: pluginId === "kilo.workbooks" ? fs : memoryFs(),
					net: { fetch: kiloFetch(pages, directories) },
				}) as never,
		},
	);
	return { host, pages, directories, fs };
}
