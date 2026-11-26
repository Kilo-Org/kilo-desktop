import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

import { desktopToolsData } from "../../testdata/chat/desktop-tools.js";
import {
	kiloServerConnection,
	type KiloServerConnection as KiloConnection,
} from "./agent-session.js";
import type { ChatStubProviderPage } from "./chat-stub-provider-page.js";

/** Kilo connects to its MCP servers lazily, after its first config read. */
const MCP_CONNECT_TIMEOUT_MS = 60_000;

/**
 * Drives the path Kilo uses to reach the app's agent tools: plugins contribute
 * them to `kilo.core/tool`, kilo.core's gateway serves them as Kilo's
 * `desktop` MCP server, and Kilo offers and calls them in a chat turn. The
 * MCP state comes from the Kilo v2 server's own API (`GET /api/mcp`); the
 * call goes through a real turn against the chat-completions stub, whose
 * captured requests show what Kilo offered and what the tool answered.
 */
export class DesktopToolsPage {
	async verifyKiloConnectedToDesktopTools(): Promise<void> {
		const connection = await kiloServerConnection();
		await expect
			.poll(() => this.desktopMcpStatus(connection), {
				message: "Kilo should report the Desktop tool server as connected",
				timeout: MCP_CONNECT_TIMEOUT_MS,
			})
			.toBe("connected");
	}

	/**
	 * The turn's model request offered `desktop_chat_html_render` as a tool of
	 * its own, and the tool's result shows kilo.chat knew which chat called
	 * it: it reached the app through the gateway with Kilo's caller context.
	 */
	async verifyDesktopToolCallReachesTheApp(stub: ChatStubProviderPage): Promise<void> {
		const captured = await stub.waitForCapturedToolResult(desktopToolsData.promptMarker);
		expect(
			captured.tools,
			"Kilo should offer Desktop's tool directly, not through Code Mode",
		).toContain(desktopToolsData.toolName);
		expect(
			captured.toolResults.join("\n"),
			"kilo.chat's html_render should answer a call from a Kilo chat",
		).toContain(desktopToolsData.renderedResult);
	}

	private async desktopMcpStatus(connection: KiloConnection): Promise<string | undefined> {
		return getPage().evaluate(async (current) => {
			const authorization = `Basic ${btoa(`${current.username}:${current.password}`)}`;
			const location = `location[directory]=${encodeURIComponent(current.globalDirectory)}`;
			const response = await fetch(`${current.baseUrl}/api/mcp?${location}`, {
				headers: { Authorization: authorization },
				cache: "no-store",
			});
			if (!response.ok) return undefined;
			const listed = (await response.json()) as {
				data: Array<{ name: string; status: { status: string } }>;
			};
			return listed.data.find((server) => server.name === "desktop")?.status.status;
		}, connection);
	}
}
