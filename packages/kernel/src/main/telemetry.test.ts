import { describe, expect, it, vi } from "vitest";

import {
	KernelDataCollection,
	KernelTelemetry,
	KernelTelemetrySink,
	type TelemetryEnvelope,
	type TelemetrySink,
} from "../builtins";
import type { PluginRegistration } from "../plugin";
import { testPlugin } from "../test-fixtures";
import { createTestHost, createTestKernelPair } from "../testing";
import type { MainKernel } from "./main-kernel";
import { createMainKernel } from "./main-kernel";

function sinkPlugin(id: string, sink: TelemetrySink): PluginRegistration {
	return testPlugin(id, {
		manifest: { contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } } },
		entry: { activate: (sdk) => void sdk.extensions.implement(KernelTelemetrySink, "sink", sink) },
	});
}

function sender(id: string, events: Record<string, string>): PluginRegistration {
	return testPlugin(id, {
		manifest: {
			contributes: {
				extensions: {
					"kernel/telemetry-event": Object.entries(events).map(([event, name]) => ({
						id: event,
						name,
					})),
				},
			},
		},
		entry: { activate: () => {} },
	});
}

function consent(kernel: MainKernel, allowed: boolean): void {
	kernel.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: { choice: allowed, allowed, installationId: "install-1", environment: "stable" },
		methods: { setChoice: () => {} },
	});
}

function recordingSink() {
	const delivered: TelemetryEnvelope[] = [];
	return {
		delivered,
		sink: { deliver: (envelope: TelemetryEnvelope) => void delivered.push(envelope) },
	};
}

async function boot(registrations: PluginRegistration[], allowed = true) {
	const kernel = createMainKernel({ registrations, host: createTestHost() });
	consent(kernel, allowed);
	await kernel.start();
	return kernel;
}

describe("kernel/telemetry", () => {
	it("delivers a declared event to every sink, describing the user", async () => {
		const first = recordingSink();
		const second = recordingSink();
		const kernel = await boot([
			sender("acme.board", { "board-opened": "Board Opened" }),
			sinkPlugin("acme.first", first.sink),
			sinkPlugin("acme.second", second.sink),
		]);

		await kernel
			.sdkFor("acme.board")
			.domainObjects.get(KernelTelemetry)!
			.methods.track({ event: "board-opened", data: { columns: 3 } });

		expect(first.delivered).toEqual([
			{
				name: "Board Opened",
				key: "acme.board/board-opened",
				pluginId: "acme.board",
				data: { columns: 3 },
				identity: { primary: null, linked: [] },
				installationId: "install-1",
				environment: "stable",
				timestamp: expect.any(Number),
			},
		]);
		expect(second.delivered).toHaveLength(1);
	});

	it("sends nothing without consent", async () => {
		const { delivered, sink } = recordingSink();
		const kernel = await boot(
			[sender("acme.board", { "board-opened": "Board Opened" }), sinkPlugin("acme.sink", sink)],
			false,
		);

		await kernel
			.sdkFor("acme.board")
			.domainObjects.get(KernelTelemetry)!
			.methods.track({ event: "board-opened" });

		expect(delivered).toEqual([]);
	});

	it("drops events the caller didn't declare, even another plugin's", async () => {
		const { delivered, sink } = recordingSink();
		const kernel = await boot([
			sender("acme.board", { "board-opened": "Board Opened" }),
			sender("acme.other", {}),
			sinkPlugin("acme.sink", sink),
		]);
		const telemetry = kernel.sdkFor("acme.other").domainObjects.get(KernelTelemetry)!;

		await telemetry.methods.track({ event: "board-opened" });
		await telemetry.methods.track({ event: "made-up" });

		expect(delivered).toEqual([]);
	});

	it("never fails the caller when a sink throws, and still delivers to the others", async () => {
		const { delivered, sink } = recordingSink();
		const error = vi.fn();
		const kernel = createMainKernel({
			registrations: [
				sender("acme.board", { "board-opened": "Board Opened" }),
				sinkPlugin("acme.broken", {
					deliver: () => {
						throw new Error("offline");
					},
				}),
				sinkPlugin("acme.sink", sink),
			],
			host: createTestHost(),
			logger: { debug() {}, info() {}, warn() {}, error },
		});
		consent(kernel, true);
		await kernel.start();

		await expect(
			kernel
				.sdkFor("acme.board")
				.domainObjects.get(KernelTelemetry)!
				.methods.track({ event: "board-opened" }),
		).resolves.toBeUndefined();
		expect(delivered).toHaveLength(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("acme.broken/sink"),
			expect.anything(),
		);
	});

	it("accepts events from a plugin's window half", async () => {
		const { delivered, sink } = recordingSink();
		const board = sender("acme.board", { "board-opened": "Board Opened" });
		const { main, renderer } = await createTestKernelPair({
			main: [board, sinkPlugin("acme.sink", sink)],
			renderer: [board],
			host: createTestHost(),
		});
		consent(main, true);

		await renderer
			.sdkFor("acme.board")
			.domainObjects.get(KernelTelemetry)!
			.methods.track({ event: "board-opened" });

		expect(delivered.map((envelope) => envelope.key)).toEqual(["acme.board/board-opened"]);
	});
});
