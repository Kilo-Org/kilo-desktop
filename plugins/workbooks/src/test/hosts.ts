import { definePlugin, KernelError } from "@kilo-desktop/kernel";
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
	type StartedWorkSession,
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

/** Lets a test delete a work session, as kilo.work-sessions would announce it. */
export interface WorkSessionsControl {
	delete(id: string): void;
}

/** kilo.work-sessions' workspaces and work sessions, in memory, for kilo.workbooks to read. */
export function workSessionsStandIn(
	workspaces: Workspace[] = [WORKSPACE],
	control: { current?: WorkSessionsControl } = {},
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
					initialState: { workSessions: [] },
					methods: new Proxy({}, { get: () => unused }) as never,
				});
				control.current = {
					delete: (id) =>
						sessions.emit("deleted", {
							workSession: {
								id,
								title: "",
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
							},
						}),
				};
			},
		}),
	};
}

/** What the chat stand-in's composer was asked to hold. */
export interface StartedChat {
	readonly text: string;
	readonly workSessionId: string | undefined;
}

/** kilo.chat's composer in the window: records the text put in each session's composer. */
export function chatStandIn(started: StartedChat[]) {
	return {
		manifest: chatManifest,
		definitions: CHAT_DEFINITIONS,
		web: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(Composer, {
					initialState: { focusedWorkSessionId: null },
					methods: {
						focus: () => undefined,
						insert: ({ workSessionId, text }) => {
							started.push({ text, workSessionId });
						},
						startChat: unused,
					},
				});
			},
		}),
	};
}

/** What happened to the sessions a `pageStart` created. */
export interface PageStarts {
	readonly opened: string[];
	readonly discarded: string[];
}

/** The New Session page's `start()`: numbered sessions, recording which were opened or discarded. */
export function pageStart(log: PageStarts = { opened: [], discarded: [] }) {
	let next = 0;
	return async (): Promise<StartedWorkSession> => {
		next += 1;
		const workSessionId = `wses_${next}`;
		return {
			workSessionId,
			directory: "/repo",
			workspaceId: "ws-1",
			branch: null,
			open: async () => {
				log.opened.push(workSessionId);
			},
			discard: async () => {
				log.discarded.push(workSessionId);
			},
		};
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

export interface WorkbooksHost {
	readonly host: PluginHost;
	readonly pages: FakePages;
	readonly directories: (string | undefined)[];
}

/** kilo.workbooks with an in-memory Pages and workspaces, booted on real kernels. */
export async function bootWorkbooks(
	options: {
		readonly pages?: FakePages;
		readonly storage?: ReturnType<typeof createMemoryStorage>;
		readonly others?: readonly Parameters<typeof createPluginHost>[0][number][];
		/** Reach Pages the real way: through a (stand-in) Kilo server over HTTP. */
		readonly viaKilo?: boolean;
		readonly workSessions?: { current?: WorkSessionsControl };
		readonly started?: StartedChat[];
		/** The `workbooks` flag; on unless a test turns it off. */
		readonly flag?: boolean;
	} = {},
): Promise<WorkbooksHost> {
	const pages = options.pages ?? new FakePages();
	const directories: (string | undefined)[] = [];
	const storage = options.storage ?? createMemoryStorage("/memory/kilo.workbooks");
	const host = await createPluginHost(
		[
			options.viaKilo ? coreWithServer() : coreRegistration,
			workSessionsStandIn([WORKSPACE], options.workSessions),
			shellRegistration,
			chatStandIn(options.started ?? []),
			{
				manifest,
				definitions: WORKBOOKS_DEFINITIONS,
				main: createWorkbooksMainEntry(
					options.viaKilo
						? {}
						: {
								pages: (_backend, directory) => {
									directories.push(directory);
									return pages;
								},
							},
				),
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
					net: { fetch: kiloFetch(pages, directories) },
				}) as never,
		},
	);
	return { host, pages, directories };
}
