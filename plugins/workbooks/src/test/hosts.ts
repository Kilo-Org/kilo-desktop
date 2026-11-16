import { definePlugin, KernelError } from "@kilo-desktop/kernel";
import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, KiloServer } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	WORK_SESSIONS_DEFINITIONS,
	Workspaces,
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

/** kilo.work-sessions' workspaces, in memory, for kilo.workbooks to read. */
export function workSessionsStandIn(workspaces: Workspace[] = [WORKSPACE]) {
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
			},
		}),
	};
}

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
	} = {},
): Promise<WorkbooksHost> {
	const pages = options.pages ?? new FakePages();
	const directories: (string | undefined)[] = [];
	const storage = options.storage ?? createMemoryStorage("/memory/kilo.workbooks");
	const host = await createPluginHost(
		[
			options.viaKilo ? coreWithServer() : coreRegistration,
			workSessionsStandIn(),
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
