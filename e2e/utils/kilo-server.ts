import { setTimeout as delay } from "node:timers/promises";

import { getPage } from "@anaconda/playwright-utils/page-utils";
import { OpenCode } from "@kilocode/client";

import { packagedServerLine } from "./kilo-server-line.js";

/** How to reach the Kilo server (Basic auth), as `kilo.core/server.connect` hands it out. */
export interface KiloServerConnection {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
	readonly globalDirectory: string;
}

/** A top-level chat on the Kilo server, in the fields specs read back. */
export interface KiloSessionSummary {
	readonly id: string;
	readonly directory?: string;
	readonly agent?: string;
}

export interface KiloAgentSummary {
	readonly name: string;
	readonly mode: "subagent" | "primary" | "all";
	readonly hidden?: boolean;
	readonly deprecated?: boolean;
}

/** v2 lists all of a location's agents only once its plugins load, a moment after its first request. */
const V2_AGENTS_WAIT_MS = 15_000;
const V2_AGENTS_POLL_MS = 200;

/**
 * Reads what the UI created straight from the packaged app's Kilo server,
 * whichever server line it ships (docs/adr/003-kilo-server-line.md): v1's
 * HTTP routes from the renderer, v2 through `@kilocode/client`.
 */
export const kiloServer = {
	async rootSessions(connection: KiloServerConnection): Promise<KiloSessionSummary[]> {
		if (packagedServerLine() === "v2") {
			const sessions: KiloSessionSummary[] = [];
			let cursor: string | undefined;
			do {
				const page = await v2Client(connection).session.list({
					parentID: null,
					...(cursor ? { cursor } : {}),
				});
				for (const session of page.data) {
					sessions.push({
						id: session.id,
						directory: session.location.directory,
						...(session.agent ? { agent: session.agent } : {}),
					});
				}
				cursor = page.cursor.next ?? undefined;
			} while (cursor);
			return sessions;
		}
		return getPage().evaluate(async (current) => {
			const authorization = `Basic ${btoa(`${current.username}:${current.password}`)}`;
			const response = await fetch(
				`${current.baseUrl}/experimental/session?roots=true&archived=true`,
				{ headers: { Authorization: authorization }, cache: "no-store" },
			);
			if (!response.ok) throw new Error(`Global session list failed with ${response.status}.`);
			return (await response.json()) as KiloSessionSummary[];
		}, connection);
	},

	/** The agents Kilo offers in its global directory. */
	async agents(connection: KiloServerConnection): Promise<KiloAgentSummary[]> {
		if (packagedServerLine() === "v2") {
			const client = v2Client(connection);
			const location = { location: { directory: connection.globalDirectory } };
			// The location's agents are complete once its plugins have registered.
			const deadline = Date.now() + V2_AGENTS_WAIT_MS;
			while ((await client.plugin.list(location)).data.length === 0 && Date.now() < deadline) {
				await delay(V2_AGENTS_POLL_MS);
			}
			const { data } = await client.agent.list(location);
			return data.map((agent) => ({ name: agent.id, mode: agent.mode, hidden: agent.hidden }));
		}
		return getPage().evaluate(async (current) => {
			const authorization = `Basic ${btoa(`${current.username}:${current.password}`)}`;
			const response = await fetch(`${current.baseUrl}/agent`, {
				headers: {
					Authorization: authorization,
					"x-kilo-directory": encodeURIComponent(current.globalDirectory),
				},
				cache: "no-store",
			});
			if (!response.ok) throw new Error(`Kilo agent catalog failed with ${response.status}.`);
			return (await response.json()) as KiloAgentSummary[];
		}, connection);
	},

	/** The status Kilo reports for its MCP server `name` (e.g. `connected`), if it lists one. */
	async mcpStatus(connection: KiloServerConnection, name: string): Promise<string | undefined> {
		if (packagedServerLine() === "v2") {
			const { data } = await v2Client(connection).mcp.list({
				location: { directory: connection.globalDirectory },
			});
			return data.find((server) => server.name === name)?.status.status;
		}
		return getPage().evaluate(
			async ({ current, server }) => {
				const authorization = `Basic ${btoa(`${current.username}:${current.password}`)}`;
				const response = await fetch(`${current.baseUrl}/mcp`, {
					headers: { Authorization: authorization },
					cache: "no-store",
				});
				if (!response.ok) return undefined;
				const statuses = (await response.json()) as Record<string, { status: string }>;
				return statuses[server]?.status;
			},
			{ current: connection, server: name },
		);
	},
};

const v2Clients = new Map<string, ReturnType<typeof OpenCode.make>>();

function v2Client(connection: KiloServerConnection): ReturnType<typeof OpenCode.make> {
	const key = `${connection.baseUrl}\n${connection.username}\n${connection.password}`;
	let client = v2Clients.get(key);
	if (!client) {
		const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
			"base64",
		);
		client = OpenCode.make({
			baseUrl: connection.baseUrl,
			headers: { authorization: `Basic ${authorization}` },
		});
		v2Clients.set(key, client);
	}
	return client;
}
