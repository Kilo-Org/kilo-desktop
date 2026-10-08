import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

type KiloConnection = {
	baseUrl: string;
	username: string;
	password: string;
};

type McpCallResult = { content: { type: string; text?: string }[]; isError?: boolean };

/** Kilo connects to its MCP servers lazily, after its first config read. */
const MCP_CONNECT_TIMEOUT_MS = 60_000;

/**
 * Drives the path Kilo uses to reach Desktop's agent tools: the renderer
 * publishes them to the main process over IPC, main serves them on the
 * `mcp.desktop` endpoint, and Kilo calls them. Everything goes through the
 * Kilo server's own API, so no model or chat is involved.
 */
export class AgentToolsPage {
	async verifyKiloConnectedToDesktopTools(): Promise<void> {
		const connection = await this.getConnection();
		await expect
			.poll(() => this.desktopMcpStatus(connection), {
				message: "Kilo should report the Desktop tool server as connected",
				timeout: MCP_CONNECT_TIMEOUT_MS,
			})
			.toBe("connected");
	}

	/**
	 * Calls a harmless read-only tool with no chat attached. The terminal tool
	 * runs in the renderer and answers that it needs a chat session — proof
	 * the call crossed Kilo → main → renderer without touching any state.
	 */
	async verifyDesktopToolCallReachesTheApp(): Promise<void> {
		const connection = await this.getConnection();
		await expect
			.poll(
				async () => {
					const result = await this.callDesktopTool(connection, "terminal_list");
					return result.content.map((part) => part.text ?? "").join("\n");
				},
				{
					message: "The Desktop terminal tool should answer through Kilo",
					timeout: MCP_CONNECT_TIMEOUT_MS,
				},
			)
			.toContain("originating Kilo chat session");
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

	private async callDesktopTool(connection: KiloConnection, name: string): Promise<McpCallResult> {
		return getPage().evaluate(
			async ({ currentConnection, toolName }) => {
				const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
				const response = await fetch(`${currentConnection.baseUrl}/experimental/mcp/call-tool`, {
					method: "POST",
					headers: { Authorization: authorization, "content-type": "application/json" },
					body: JSON.stringify({ server: "desktop", name: toolName, arguments: {} }),
				});
				if (!response.ok) return { content: [{ type: "text", text: `HTTP ${response.status}` }] };
				return (await response.json()) as McpCallResult;
			},
			{ currentConnection: connection, toolName: name },
		);
	}

	private async getConnection(): Promise<KiloConnection> {
		return getPage().evaluate(async () => {
			type InvokeResult =
				| { ok: true; value: unknown }
				| { ok: false; error: { code: string; message: string } };
			type DesktopGlobal = typeof globalThis & {
				desktopApi: {
					invoke(
						channel: "feature:invoke",
						input: { featureId: string; channel: string; args?: unknown },
					): Promise<InvokeResult>;
				};
			};
			const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
				featureId: "kilo-server",
				channel: "server.getConnection",
			});
			if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			return response.value as KiloConnection;
		});
	}
}
