import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bundledKiloExecutable, startRealKilo2, type RealKilo2 } from "../../test/real-kilo2";
import { createServerClient, globalSettings } from "../server-client";
import { managedKiloPluginDirectory } from "./managed-kilo-plugins";
import {
	KILO_CALLER_CONTEXT_KEY,
	reconcileKiloCallerContextPlugin,
} from "./tool-gateway/kilo-caller-context-plugin";

const kiloExecutable = bundledKiloExecutable();

/**
 * A stand-in plugin with a `desktop_probe` tool that records the input Kilo
 * hands it, so the test sees what the caller-context plugin added.
 */
const probePlugin = (log: string) => `import { appendFileSync } from "node:fs";
export default {
  id: "probe",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => tools.add({
      name: "desktop_probe",
      description: "Probe",
      options: { codemode: false },
      input: { type: "object", properties: { text: { type: "string" } }, additionalProperties: true },
      execute: async (input) => {
        appendFileSync(${JSON.stringify(log)}, JSON.stringify(input) + "\\n");
        return { content: "ok" };
      },
    }));
  },
};
`;

/** A stand-in model that calls `desktop_probe` for a user's message, then answers. */
async function standInModel(): Promise<{ server: Server; url: string }> {
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
			tools?: { function?: { name?: string } }[];
			messages: { role: string }[];
		};
		const offered = (body.tools ?? []).some((tool) => tool.function?.name === "desktop_probe");
		const callTool = offered && body.messages.at(-1)?.role === "user";
		const chunk = (delta: object, finish: string | null) =>
			`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
		response.writeHead(200, { "content-type": "text/event-stream" });
		if (callTool) {
			const call = { name: "desktop_probe", arguments: JSON.stringify({ text: "hi" }) };
			response.write(
				chunk(
					{
						role: "assistant",
						tool_calls: [{ index: 0, id: "call_1", type: "function", function: call }],
					},
					null,
				),
			);
			response.write(chunk({}, "tool_calls"));
		} else {
			response.write(chunk({ role: "assistant", content: "Done." }, null));
			response.write(chunk({}, "stop"));
		}
		response.end("data: [DONE]\n\n");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` };
}

describe.skipIf(!kiloExecutable)("Desktop's managed Kilo plugins on the bundled kilo2", () => {
	let model: Awaited<ReturnType<typeof standInModel>>;
	let server: RealKilo2;
	let log: string;

	beforeEach(async () => {
		model = await standInModel();
		server = await startRealKilo2(
			kiloExecutable!,
			{},
			{
				prepare: async (runtimeDirectory) => {
					const plugins = managedKiloPluginDirectory(runtimeDirectory);
					await reconcileKiloCallerContextPlugin(plugins);
					log = path.join(runtimeDirectory, "probe.log");
					await mkdir(path.join(plugins, "anaconda-probe"), { recursive: true });
					await writeFile(path.join(plugins, "anaconda-probe", "index.js"), probePlugin(log));
				},
			},
		);
	});

	afterEach(async () => {
		await server.stop();
		model.server.close();
	});

	it("loads them from the inline config, and stamps desktop_ calls with the calling chat", async () => {
		const client = createServerClient(server.connection);
		const project = path.join(server.connection.globalDirectory, "project");
		await mkdir(project);
		const location = { location: { directory: project } };
		await vi.waitFor(
			async () => {
				const ids = (await client.plugin.list(location)).data.map((plugin) => plugin.id);
				expect(ids).toEqual(expect.arrayContaining(["anaconda-desktop-caller-context", "probe"]));
			},
			{ timeout: 10_000 },
		);
		await globalSettings(client, project).write({
			model: "standin/m",
			providers: {
				standin: {
					name: "S",
					package: "@ai-sdk/openai-compatible",
					settings: { baseURL: model.url, apiKey: "k" },
					models: { m: { name: "M", limit: { context: 200_000, output: 4_000 } } },
				},
			},
		});
		await client.location.reload();

		const session = await client.session.create({ location: { directory: project } });
		await client.session.prompt({ sessionID: session.id, text: "probe" });

		await vi.waitFor(
			async () => {
				const [first] = (await readFile(log, "utf8")).trim().split("\n");
				expect(JSON.parse(first!)).toEqual({
					text: "hi",
					[KILO_CALLER_CONTEXT_KEY]: { version: 1, sessionId: session.id, callId: "call_1" },
				});
			},
			{ timeout: 10_000 },
		);
	});
});
