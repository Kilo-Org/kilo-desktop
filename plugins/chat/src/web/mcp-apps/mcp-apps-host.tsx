import type { McpAppResource, McpAppsHost } from "@assistant-ui/react";
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { useChatConnection } from "../runtime/chat-connection";
import { hostableMcpAppByResource, type HostableMcpApp } from "./mcp-app-registry";

const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

type ReadResourceResult = {
	uri?: string;
	mimeType?: string;
	text?: string;
	blob?: string;
	meta?: Record<string, unknown>;
};

function authorization(connection: ServerConnection): string {
	return `Basic ${globalThis.btoa(`${connection.username}:${connection.password}`)}`;
}

function decodeBase64(blob: string): string {
	const bytes = Uint8Array.from(globalThis.atob(blob), (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/**
 * The MCP App data plane over Kilo's experimental resource and tool
 * endpoints, which reach the MCP servers (the app's own agent tools are its
 * `desktop` server). A widget contributed with its own HTML is served from
 * that instead.
 */
export function createKiloMcpAppsHost({
	connection,
	localApp,
	fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
}: {
	connection: () => ServerConnection | undefined;
	localApp: (resourceUri: string) => HostableMcpApp | undefined;
	fetch?: typeof fetch;
}): McpAppsHost {
	const server = (): ServerConnection => {
		const current = connection();
		if (!current) throw new Error("Kilo isn't running.");
		return current;
	};
	async function request(path: string, init: RequestInit = {}): Promise<unknown> {
		const current = server();
		const response = await fetchImpl(`${current.baseUrl}${path}`, {
			...init,
			headers: {
				Authorization: authorization(current),
				...(init.body ? { "Content-Type": "application/json" } : {}),
			},
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Kilo ${path} failed (${response.status}): ${text || response.statusText}`);
		}
		return response.json();
	}
	const post = (path: string, body: unknown) =>
		request(path, { method: "POST", body: JSON.stringify(body) });

	return {
		async loadResource({ uri, serverId }) {
			const local = localApp(uri)?.implementation?.loadHtml;
			if (local) return { uri, mimeType: MCP_APP_MIME_TYPE, html: await local() };
			const result = (await post("/experimental/resource/read", {
				uri,
				...(serverId ? { server: serverId } : {}),
			})) as ReadResourceResult;
			if (result.mimeType !== MCP_APP_MIME_TYPE && result.mimeType !== "text/html") {
				throw new Error(
					`Resource at ${uri} is not an MCP App (mimeType: ${result.mimeType ?? "unknown"})`,
				);
			}
			return {
				uri: result.uri ?? uri,
				mimeType: MCP_APP_MIME_TYPE,
				html: result.text ?? (result.blob ? decodeBase64(result.blob) : ""),
				...(result.meta ? { meta: result.meta } : {}),
			} satisfies McpAppResource;
		},
		callTool: ({ name, arguments: args, serverId }) =>
			post("/experimental/mcp/call-tool", {
				name,
				...(args ? { arguments: args } : {}),
				...(serverId ? { server: serverId } : {}),
			}),
		readResource: ({ uri, serverId }) =>
			post("/experimental/resource/read", { uri, ...(serverId ? { server: serverId } : {}) }),
		listResources: (params) => {
			const serverId =
				params && typeof params === "object" && "serverId" in params
					? (params as { serverId?: unknown }).serverId
					: undefined;
			const query =
				typeof serverId === "string" && serverId ? `?server=${encodeURIComponent(serverId)}` : "";
			return request(`/experimental/resource${query}`);
		},
	};
}

export const McpAppsHostContext = createContext<McpAppsHost | null>(null);

/** The pane's MCP App host, over the window's Kilo connection. */
export function KiloMcpAppsHostProvider({ children }: { children: ReactNode }) {
	const { connection } = useChatConnection();
	const latest = useRef(connection);
	latest.current = connection;
	const host = useMemo(
		() =>
			createKiloMcpAppsHost({
				connection: () => latest.current,
				localApp: hostableMcpAppByResource,
			}),
		[],
	);
	return <McpAppsHostContext.Provider value={host}>{children}</McpAppsHostContext.Provider>;
}

export function useMcpAppsHost(): McpAppsHost | null {
	return useContext(McpAppsHostContext);
}
