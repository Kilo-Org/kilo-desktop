import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

import { agentData } from "../../../testdata/agent.js";
import { callDomainMethod } from "../../../utils/kernel-domains.js";

interface KiloConnection {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
}

type McpCallResult = { content: { type: string; text?: string }[]; isError?: boolean };

/** Kilo connects to its MCP servers lazily, after its first config read. */
const MCP_CONNECT_TIMEOUT_MS = 60_000;

/**
 * Drives the path Kilo uses to reach the app's agent tools: plugins contribute
 * them to `kilo.agent/tool`, kilo.agent's gateway serves them as Kilo's
 * `desktop` MCP server, and Kilo calls them. Everything goes through the Kilo
 * server's own API, so no model or chat is involved.
 */
export class AgentToolsPage {
	async verifyKiloConnectedToDesktopTools(): Promise<void> {
		const connection = await this.connection();
		await expect
			.poll(() => this.desktopMcpStatus(connection), {
				message: "Kilo should report the Desktop tool server as connected",
				timeout: MCP_CONNECT_TIMEOUT_MS,
			})
			.toBe("connected");
	}

	/**
	 * Calls kilo.chat's `html_render` with no chat attached. It only answers
	 * that a page needs a Kilo chat to be seen — proof the call crossed Kilo →
	 * the gateway → kilo.chat's tool without touching any state.
	 */
	async verifyDesktopToolCallReachesTheApp(): Promise<void> {
		const connection = await this.connection();
		await expect
			.poll(
				async () => {
					const result = await this.callDesktopTool(connection, "chat_html_render", {
						title: "Probe",
						html: "<p>probe</p>",
					});
					return result.content.map((part) => part.text ?? "").join("\n");
				},
				{
					message: "kilo.chat's html_render tool should answer through Kilo",
					timeout: MCP_CONNECT_TIMEOUT_MS,
				},
			)
			.toContain("Kilo Desktop chat");
	}

	private connection(): Promise<KiloConnection> {
		return callDomainMethod(
			agentData.serverDomain,
			"connect",
			undefined,
			"kilo.chat",
		) as Promise<KiloConnection>;
	}

	private async desktopMcpStatus(connection: KiloConnection): Promise<string | undefined> {
		return getPage().evaluate(async (currentConnection) => {
			const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
			const response = await fetch(`${currentConnection.baseUrl}/mcp`, {
				headers: { Authorization: authorization },
				cache: "no-store",
			});
			if (!response.ok) return undefined;
			const statuses = (await response.json()) as Record<string, { status: string }>;
			return statuses.desktop?.status;
		}, connection);
	}

	private async callDesktopTool(
		connection: KiloConnection,
		name: string,
		args: Record<string, unknown>,
	): Promise<McpCallResult> {
		return getPage().evaluate(
			async ({ currentConnection, toolName, toolArgs }) => {
				const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
				const response = await fetch(`${currentConnection.baseUrl}/experimental/mcp/call-tool`, {
					method: "POST",
					headers: { Authorization: authorization, "content-type": "application/json" },
					body: JSON.stringify({ server: "desktop", name: toolName, arguments: toolArgs }),
				});
				if (!response.ok) return { content: [{ type: "text", text: `HTTP ${response.status}` }] };
				return (await response.json()) as McpCallResult;
			},
			{ currentConnection: connection, toolName: name, toolArgs: args },
		);
	}
}
