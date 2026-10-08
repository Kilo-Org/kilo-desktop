import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeatureRouter } from "@kilo-desktop/feature-sdk";
import { createFakeMainSdk } from "@kilo-desktop/testing";

import { descriptor, FakeToolProducer } from "../../test/fake-tool-producer.js";
import { createToolGateway, externalClientsDefaultPort, type ToolGateway } from "./index.js";

const logger = { info: vi.fn(), warn: vi.fn() };
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function setup(onExternalClientsChange = vi.fn()): { gateway: ToolGateway; router: FeatureRouter } {
	const router = new FeatureRouter();
	const gateway = createToolGateway({
		ports: router.createMainSdk("kilo-server").ports,
		storage: createFakeMainSdk({ storageDir: "/tmp/kilo-server-gateway" }).storage,
		logger,
		channel: "development",
		onExternalClientsChange,
	});
	cleanups.push(() => gateway.dispose());
	return { gateway, router };
}

async function connectKilo(url: string, token: string): Promise<Client> {
	const client = new Client({ name: "kilo-test", version: "0.0.0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(url), {
			requestInit: { headers: { Authorization: `Bearer ${token}` } },
		}),
	);
	cleanups.push(() => client.close());
	return client;
}

describe("createToolGateway", () => {
	it("serves to Kilo the tools the app window publishes over its catalog port", async () => {
		const { gateway, router } = setup();
		const producer = new FakeToolProducer();
		await router.connectPort("kilo-server", "tool-catalog", producer.port, { version: 1 });
		producer.publish([descriptor("todos_echo")]);
		producer.respond = (call) => call.args;

		const connection = await gateway.startKiloEndpoint();
		const client = await connectKilo(connection!.url, connection!.token);

		expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["todos_echo"]);
		await expect(
			client.callTool({ name: "todos_echo", arguments: { text: "hi" } }),
		).resolves.toMatchObject({
			content: [{ type: "text", text: JSON.stringify({ text: "hi" }, null, 2) }],
		});
	});

	it("refuses a catalog port that speaks another protocol version", async () => {
		const { router } = setup();

		await expect(
			router.connectPort("kilo-server", "tool-catalog", new FakeToolProducer().port, {
				version: 2,
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("keeps external AI apps off until the user enables them", async () => {
		const onChange = vi.fn();
		const { gateway } = setup(onChange);

		await gateway.startExternalClients();

		expect(gateway.externalClients.getState()).toMatchObject({
			enabled: false,
			port: externalClientsDefaultPort("development"),
			status: { status: "stopped" },
		});
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
	});

	it("uses a distinct default external port per release channel", () => {
		expect([
			externalClientsDefaultPort("stable"),
			externalClientsDefaultPort("preview"),
			externalClientsDefaultPort("development"),
		]).toEqual([9350, 9351, 9352]);
	});

	it("does not start the Kilo endpoint after disposal", async () => {
		const { gateway } = setup();
		await gateway.dispose();

		await expect(gateway.startKiloEndpoint()).resolves.toBeUndefined();
	});
});
