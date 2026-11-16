import { createServer } from "node:net";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveText,
	fill,
	getLocatorByRole,
	getLocatorByTestId,
	getText,
} from "@anaconda/playwright-utils";
import { expect } from "@playwright/test";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const ENDPOINT_START_TIMEOUT_MS = 15_000;

type JsonRpcResponse = { result?: Record<string, unknown>; error?: { message: string } };

/**
 * Drives Settings → External AI apps and plays an external MCP client
 * (Cursor, Claude Code, ...) against the endpoint it opens, using raw MCP
 * Streamable HTTP from the test process.
 */
export class ExternalAiAppsPage {
	#port: number | undefined;
	#token: string | undefined;

	get #url(): string {
		if (this.#port === undefined) throw new Error("Choose a port before connecting.");
		return `http://127.0.0.1:${this.#port}/mcp`;
	}

	/** The section is gated on kilo.core's `external-api-apps-settings` flag, which `package:e2e` forces on. */
	async verifyOfferedInSettings(): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByTestId("settings-section-external-ai-apps"),
			"Settings should offer External AI apps while its flag is on",
		);
	}

	async open(): Promise<void> {
		await click(getLocatorByTestId("settings-section-external-ai-apps"));
		await expectElementToBeVisible(
			getLocatorByTestId("external-ai-apps-settings"),
			"External AI apps settings should be visible",
		);
	}

	/** A free port keeps parallel workers and installed apps from colliding. */
	async useFreePort(): Promise<void> {
		this.#port = await freePort();
		await fill(getLocatorByTestId("external-ai-apps-port"), String(this.#port));
		await click(getLocatorByTestId("external-ai-apps-port-save"));
	}

	async enable(): Promise<void> {
		await click(getLocatorByTestId("external-ai-apps-enabled"));
		await expectElementToHaveText(
			getLocatorByTestId("external-ai-apps-status"),
			new RegExp(this.#url),
			{
				message: "The endpoint should report where it listens",
				timeout: ENDPOINT_START_TIMEOUT_MS,
			},
		);
	}

	async disable(): Promise<void> {
		await click(getLocatorByTestId("external-ai-apps-enabled"));
		await expectElementToHaveText(getLocatorByTestId("external-ai-apps-status"), "Off", {
			message: "The endpoint should report that it is off",
		});
	}

	async pairApp(name: string): Promise<void> {
		await fill(getLocatorByTestId("external-ai-apps-client-name"), name);
		await click(getLocatorByTestId("external-ai-apps-pair"));
		await expectElementToBeVisible(
			getLocatorByTestId("external-client-token-dialog"),
			"Pairing should show the app's token",
		);
		this.#token = (await getText(getLocatorByTestId("external-client-token"))).trim();
		await click(getLocatorByTestId("external-client-token-done"));
		await expectElementToBeHidden(getLocatorByTestId("external-client-token-dialog"), {
			message: "The token dialog should close",
		});
	}

	async removeApp(name: string): Promise<void> {
		await click(getLocatorByRole("button", { name: `Remove ${name}` }));
		await click(getLocatorByTestId("external-client-remove-confirm"));
		await expectElementToBeHidden(getLocatorByRole("button", { name: `Remove ${name}` }), {
			message: `${name} should no longer be paired`,
		});
	}

	/**
	 * Lists the tools and calls the harmless terminal tool, which runs in main
	 * and refuses because external apps carry no chat session.
	 */
	async verifyPairedAppCanUseDesktopTools(): Promise<void> {
		const session = await this.#initialize();
		expect(session.status, "A paired app should be able to open an MCP session").toBe(200);

		const tools = await this.#request(session.id, 2, "tools/list", {});
		const names = ((tools.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name);
		expect(names, "External apps should see the Desktop tools").toContain("terminal_list");

		const call = await this.#request(session.id, 3, "tools/call", {
			name: "terminal_list",
			arguments: {},
		});
		expect(
			JSON.stringify(call.result),
			"The call should reach the app without any Kilo chat session",
		).toContain("originating Kilo chat session");
	}

	async verifyRemovedAppIsRefused(): Promise<void> {
		const session = await this.#initialize();
		expect(session.status, "A removed app's token should be refused").toBe(401);
	}

	async verifyEndpointIsClosed(): Promise<void> {
		await expect(
			fetch(this.#url, { method: "POST" }),
			"The endpoint should stop listening when switched off",
		).rejects.toThrow();
	}

	async #initialize(): Promise<{ status: number; id: string | undefined }> {
		const response = await fetch(this.#url, {
			method: "POST",
			headers: this.#headers(),
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "e2e-external-app", version: "0.0.0" },
				},
			}),
		});
		const id = response.headers.get("mcp-session-id") ?? undefined;
		await response.body?.cancel();
		if (id) {
			await fetch(this.#url, {
				method: "POST",
				headers: { ...this.#headers(), "mcp-session-id": id },
				body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
			});
		}
		return { status: response.status, id };
	}

	async #request(
		sessionId: string | undefined,
		id: number,
		method: string,
		params: Record<string, unknown>,
	): Promise<JsonRpcResponse> {
		const response = await fetch(this.#url, {
			method: "POST",
			headers: {
				...this.#headers(),
				...(sessionId ? { "mcp-session-id": sessionId } : {}),
				"mcp-protocol-version": MCP_PROTOCOL_VERSION,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
		});
		return parseJsonRpc(await response.text(), response.headers.get("content-type"));
	}

	#headers(): Record<string, string> {
		return {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
		};
	}
}

/** Streamable HTTP answers either as JSON or as a one-message SSE stream. */
function parseJsonRpc(body: string, contentType: string | null): JsonRpcResponse {
	if (!contentType?.includes("text/event-stream")) return JSON.parse(body) as JsonRpcResponse;
	const data = body
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trim())
		.find((line) => line.length > 0);
	return data ? (JSON.parse(data) as JsonRpcResponse) : {};
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	if (!address || typeof address === "string") throw new Error("No free port");
	return address.port;
}
