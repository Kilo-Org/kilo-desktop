import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import type { ToolCatalogProducerMessage } from "@kilo-desktop/feature-sdk";

import { startToolCatalogPublisher } from "./tool-catalog-publisher";

type CatalogMessage = Extract<ToolCatalogProducerMessage, { type: "catalog" }>;
type ResultMessage = Extract<ToolCatalogProducerMessage, { type: "result" }>;

const stops: (() => void)[] = [];

afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

/** Boots a publisher whose port's far end plays the main process. */
function setup() {
	const todos = createFakeSdk({ featureId: "todos" });
	const system = createFakeFeatureSystem({ sdks: { todos } });
	const received: ToolCatalogProducerMessage[] = [];
	const opened: { featureId: string; channel: string; args: unknown }[] = [];
	let main: MessagePort | undefined;
	system.services.openPort = (featureId, channel, args) => {
		opened.push({ featureId, channel, args });
		const channelPair = new MessageChannel();
		main = channelPair.port2;
		main.onmessage = (event: MessageEvent<ToolCatalogProducerMessage>) => received.push(event.data);
		return channelPair.port1;
	};
	return {
		todos,
		system,
		received,
		opened,
		send: (message: unknown) => main?.postMessage(message),
		catalogs: () =>
			received.filter((message): message is CatalogMessage => message.type === "catalog"),
		results: () =>
			received.filter((message): message is ResultMessage => message.type === "result"),
		start: () => {
			stops.push(startToolCatalogPublisher(system, { retryDelaysMs: [10] }));
		},
	};
}

describe("startToolCatalogPublisher", () => {
	it("opens the kilo-server catalog port with the protocol version", async () => {
		const harness = setup();

		harness.start();

		expect(harness.opened).toEqual([
			{ featureId: "kilo-server", channel: "tool-catalog", args: { version: 1 } },
		]);
		await expect.poll(() => harness.catalogs()).toHaveLength(1);
	});

	it("publishes only opted-in tools under their MCP names", async () => {
		const harness = setup();
		harness.todos.tools.register({
			name: "echo",
			description: "Echo",
			exposeToModelContext: true,
			annotations: { readOnlyHint: true },
			handler: (args) => args,
		});
		harness.todos.tools.register({
			name: "hidden",
			description: "In-app only",
			handler: () => "never",
		});

		harness.start();

		await expect
			.poll(() => harness.catalogs().at(-1)?.tools)
			.toEqual([
				{
					name: "todos_echo",
					description: "Echo",
					inputSchema: { type: "object", properties: {} },
					annotations: { readOnlyHint: true },
				},
			]);
	});

	it("coalesces a burst of registrations into one snapshot", async () => {
		const harness = setup();
		harness.start();
		await expect.poll(() => harness.catalogs()).toHaveLength(1);

		for (let index = 0; index < 50; index++) {
			harness.todos.tools.register({
				name: `tool${index}`,
				description: "Burst",
				exposeToModelContext: true,
				handler: () => index,
			});
		}

		await expect.poll(() => harness.catalogs()).toHaveLength(2);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(harness.catalogs()).toHaveLength(2);
		expect(harness.catalogs()[1]?.tools).toHaveLength(50);
		expect(harness.catalogs()[1]?.revision).toBeGreaterThan(harness.catalogs()[0]!.revision);
	});

	it("keeps the first of two tools whose names sanitize alike", async () => {
		const harness = setup();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		harness.todos.tools.register({
			name: "collide.x",
			description: "First",
			exposeToModelContext: true,
			handler: () => "first",
		});
		harness.todos.tools.register({
			name: "collide_x",
			description: "Second",
			exposeToModelContext: true,
			handler: () => "second",
		});

		harness.start();

		await expect
			.poll(() =>
				harness
					.catalogs()
					.at(-1)
					?.tools.map((tool) => (tool as { description: string }).description),
			)
			.toEqual(["First"]);
	});

	it("runs calls through the registry with the caller context from main", async () => {
		const harness = setup();
		harness.todos.tools.register({
			name: "caller",
			description: "Return caller",
			exposeToModelContext: true,
			handler: (args, context) => ({ args, context }),
		});
		harness.start();
		await expect.poll(() => harness.catalogs()).toHaveLength(1);

		harness.send({
			type: "call",
			id: "c1",
			name: "todos_caller",
			args: { a: 1 },
			context: { kiloSessionId: "s-a", kiloCallId: "k-a" },
		});

		await expect
			.poll(() => harness.results())
			.toEqual([
				{
					type: "result",
					id: "c1",
					ok: true,
					result: { args: { a: 1 }, context: { kiloSessionId: "s-a", kiloCallId: "k-a" } },
				},
			]);
	});

	it("reports handler failures and unknown tools as error results", async () => {
		const harness = setup();
		harness.todos.tools.register({
			name: "boom",
			description: "Fails",
			exposeToModelContext: true,
			handler: () => {
				throw new Error("kaboom");
			},
		});
		harness.start();
		await expect.poll(() => harness.catalogs()).toHaveLength(1);

		harness.send({ type: "call", id: "c1", name: "todos_boom", args: {}, context: {} });
		harness.send({ type: "call", id: "c2", name: "todos_missing", args: {}, context: {} });

		await expect.poll(() => harness.results()).toHaveLength(2);
		expect(harness.results()).toEqual(
			expect.arrayContaining([
				{ type: "result", id: "c1", ok: false, error: { message: "kaboom" } },
				{
					type: "result",
					id: "c2",
					ok: false,
					error: { message: 'Unknown tool "todos_missing".' },
				},
			]),
		);
	});

	it("ignores a cancel for a call that is not running", async () => {
		const harness = setup();
		harness.todos.tools.register({
			name: "echo",
			description: "Echo",
			exposeToModelContext: true,
			handler: () => "done",
		});
		harness.start();
		await expect.poll(() => harness.catalogs()).toHaveLength(1);

		harness.send({ type: "cancel", id: "late" });
		harness.send({ type: "call", id: "late", name: "todos_echo", args: {}, context: {} });

		await expect
			.poll(() => harness.results())
			.toEqual([{ type: "result", id: "late", ok: true, result: "done" }]);
	});

	it("drops the result of a call main cancelled", async () => {
		const harness = setup();
		let finish!: (value: string) => void;
		harness.todos.tools.register({
			name: "slow",
			description: "Slow",
			exposeToModelContext: true,
			handler: () => new Promise<string>((resolve) => (finish = resolve)),
		});
		harness.todos.tools.register({
			name: "fast",
			description: "Fast",
			exposeToModelContext: true,
			handler: () => "done",
		});
		harness.start();
		await expect.poll(() => harness.catalogs()).toHaveLength(1);

		harness.send({ type: "call", id: "slow", name: "todos_slow", args: {}, context: {} });
		await expect.poll(() => typeof finish).toBe("function");
		harness.send({ type: "cancel", id: "slow" });
		harness.send({ type: "call", id: "fast", name: "todos_fast", args: {}, context: {} });
		await expect.poll(() => harness.results().map((result) => result.id)).toEqual(["fast"]);
		finish("late");
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(harness.results().map((result) => result.id)).toEqual(["fast"]);
	});

	it("retries opening the port when the host transport fails", async () => {
		const harness = setup();
		const working = harness.system.services.openPort!;
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		let failures = 2;
		harness.system.services.openPort = (...args) => {
			if (failures-- > 0) throw new Error("bridge not ready");
			return working(...args);
		};

		harness.start();

		await expect.poll(() => harness.catalogs()).toHaveLength(1);
	});

	it("does nothing without a host port transport (browser mode)", () => {
		const todos = createFakeSdk({ featureId: "todos" });
		const system = createFakeFeatureSystem({ sdks: { todos } });

		const stop = startToolCatalogPublisher(system);

		expect(stop).not.toThrow();
	});
});
