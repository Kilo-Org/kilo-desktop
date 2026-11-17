import { KernelError } from "@kilo-desktop/kernel";
import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { toolResultPayload, type PagesToolCaller } from "./pages-tools";

export interface KiloPagesOptions {
	readonly connect: () => Promise<ServerConnection>;
	readonly fetch: (input: URL, init: RequestInit) => Promise<Response>;
	/** The Kilo MCP server name the Pages tools live on (the user's `pages` entry). */
	readonly server: string;
}

/**
 * Calls Pages tools through Kilo's own MCP connection
 * (`POST /experimental/mcp/call-tool`), so the app needs no Pages credentials
 * of its own: the user signs in to the `pages` MCP entry once. Kilo connects
 * MCP servers per directory; calls go to its global instance (the app's own
 * runtime folder, as account and model lookups do), so workbooks work from
 * any session, in a workspace or not. That needs the `pages` entry in global
 * Kilo config, not a project's.
 */
export function kiloPagesCaller(options: KiloPagesOptions): PagesToolCaller {
	return {
		async call(tool, args) {
			const connection = await options.connect();
			const url = new URL("/experimental/mcp/call-tool", connection.baseUrl);
			url.searchParams.set("directory", connection.globalDirectory);
			const token = Buffer.from(`${connection.username}:${connection.password}`).toString("base64");
			const response = await options.fetch(url, {
				method: "POST",
				headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
				body: JSON.stringify({ server: options.server, name: tool, arguments: args }),
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new KernelError(
					"UNAVAILABLE",
					`Couldn't reach Pages through Kilo (${response.status}): ${text || response.statusText}. Is the "${options.server}" MCP server signed in?`,
				);
			}
			return toolResultPayload(tool, await response.json());
		},
	};
}
