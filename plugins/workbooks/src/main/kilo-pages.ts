import { KernelError } from "@kilo-desktop/kernel";
import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { toolResultPayload, type PagesToolCaller } from "./pages-tools";

export interface KiloPagesOptions {
	readonly connect: () => Promise<ServerConnection>;
	readonly fetch: (input: URL, init: RequestInit) => Promise<Response>;
	/** The Kilo MCP server name the Pages tools live on (the user's `pages` entry). */
	readonly server: string;
	/** The directory whose Kilo instance holds the MCP connection; Kilo connects MCP servers per directory. */
	readonly directory?: string;
}

/**
 * Calls Pages tools through Kilo's own MCP connection
 * (`POST /experimental/mcp/call-tool`), so the app needs no Pages credentials
 * of its own: the user signs in to the `pages` MCP entry once.
 */
export function kiloPagesCaller(options: KiloPagesOptions): PagesToolCaller {
	return {
		async call(tool, args) {
			const connection = await options.connect();
			const url = new URL("/experimental/mcp/call-tool", connection.baseUrl);
			if (options.directory) url.searchParams.set("directory", options.directory);
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
