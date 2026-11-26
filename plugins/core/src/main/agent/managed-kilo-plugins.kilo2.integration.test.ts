import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { OpenCode } from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	kilo2Executable,
	STAND_IN_MODEL,
	standInProviderConfig,
	startKilo2,
	startStandInModel,
	type Kilo2,
	type StandInModel,
	type StandInRequest,
} from "../../testing";
import {
	echoTool,
	FakeToolSource,
	toolContribution,
	type RecordedCall,
} from "../../test/agent/tool-source";
import { reconcileChatSystemPlugin } from "./conversations/chat-system-plugin";
import { promptMetadata } from "./conversations/index";
import { KiloToolEndpoint } from "./tool-gateway/kilo-tool-endpoint";
import { reconcileKiloCallerContextPlugin } from "./tool-gateway/kilo-caller-context-plugin";
import { ToolCatalog } from "./tool-gateway/tool-catalog";
import { reconcileWebMcpRelayConfig } from "./webmcp-relay-config";

/**
 * Desktop's own Kilo server plugins and its `desktop` MCP entry on the bundled
 * kilo2, with a stand-in model: the chat system prompt plugin feeds a
 * prompt's system text to the model, the relay's tools reach the model as
 * direct calls named `desktop_<tool>` (Code Mode off), and the caller-context
 * plugin tells the tool gateway which chat and call ran them.
 */
describe.skipIf(!kilo2Executable)("Desktop's managed Kilo plugins on kilo2", () => {
	const cleanups: (() => Promise<void> | void)[] = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	async function start(reply: Parameters<typeof startStandInModel>[0]) {
		const calls: RecordedCall[] = [];
		const source = new FakeToolSource();
		source.set([toolContribution("kilo.notes/echo", echoTool(calls))]);
		const catalog = new ToolCatalog(source);
		cleanups.push(() => catalog.dispose());
		const endpoint = new KiloToolEndpoint({
			catalog,
			policy: {
				isSignedIn: () => true,
				stampOfChat: () => ({ workSessionId: "wses_1", workspaceId: "w1" }),
			},
		});
		cleanups.push(() => endpoint.stop());
		const connection = await endpoint.start();
		const model: StandInModel = await startStandInModel(reply);
		cleanups.push(() => model.stop());
		const kilo: Kilo2 = await startKilo2({
			webMcpEndpoint: () => connection,
			before: async (home) => {
				const runtime = path.join(home, "runtime");
				const configDirectory = path.join(runtime, "config", "kilo2");
				await writeFile(
					path.join(configDirectory, "kilo2.jsonc"),
					JSON.stringify(standInProviderConfig(model.baseURL)),
				);
				await reconcileWebMcpRelayConfig({ configDirectory, enabled: true });
				await reconcileKiloCallerContextPlugin(path.join(runtime, "kilo-plugins"));
				await reconcileChatSystemPlugin(path.join(runtime, "kilo-plugins"));
			},
		});
		cleanups.push(() => kilo.stop());
		const client = OpenCode.make({
			baseUrl: kilo.connection.baseUrl,
			headers: {
				authorization: `Basic ${btoa(`${kilo.connection.username}:${kilo.connection.password}`)}`,
			},
		});
		const project = path.join(await realpath(kilo.home), "project");
		await mkdir(project);
		const location = { directory: project };
		await vi.waitFor(
			async () =>
				expect((await client.plugin.list({ location })).data.map((plugin) => plugin.id)).toEqual(
					expect.arrayContaining([
						"anaconda-desktop-caller-context",
						"anaconda-desktop-chat-system",
					]),
				),
			{ timeout: 20_000 },
		);
		const session = await client.session.create({ location, model: STAND_IN_MODEL });
		return { client, session, model, calls };
	}

	const toolTurn = (request: StandInRequest) => {
		if (!request.tools?.length) return { text: ["Title"] };
		if (request.messages.some((message) => message.role === "tool")) return { text: ["Done."] };
		return {
			toolCalls: [{ id: "call_desktop", name: "desktop_notes_echo", arguments: { text: "hi" } }],
		};
	};

	it("gives the model the prompt's system text", async () => {
		const { client, session, model } = await start(() => ({ text: ["Hello."] }));

		await client.session.prompt({
			sessionID: session.id,
			text: "Hi",
			metadata: promptMetadata("DESKTOP-WORKSPACE-CONTEXT") as never,
		});

		await vi.waitFor(
			() => expect(model.requests.some((request) => request.tools?.length)).toBe(true),
			{
				timeout: 20_000,
			},
		);
		const turn = model.requests.find((request) => request.tools?.length)!;
		const system = turn.messages.filter((message) => message.role === "system");
		expect(JSON.stringify(system)).toContain("DESKTOP-WORKSPACE-CONTEXT");
		const user = turn.messages.filter((message) => message.role === "user");
		expect(JSON.stringify(user)).not.toContain("DESKTOP-WORKSPACE-CONTEXT");
	});

	it("offers Desktop's tools directly and tells the gateway which chat and call ran them", async () => {
		const { client, session, model, calls } = await start(toolTurn);

		await client.session.prompt({ sessionID: session.id, text: "Echo hi" });

		await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 20_000 });
		const turn = model.requests.find((request) => request.tools?.length)!;
		expect(turn.tools!.map((tool) => tool.function?.name)).toContain("desktop_notes_echo");
		expect(calls[0]).toMatchObject({
			input: { text: "hi" },
			context: {
				chatId: session.id,
				callId: "call_desktop",
				workSessionId: "wses_1",
				workspaceId: "w1",
			},
		});
	});
});
