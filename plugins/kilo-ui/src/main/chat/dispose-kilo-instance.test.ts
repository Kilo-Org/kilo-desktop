import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import { createKiloInstanceDisposer } from "./dispose-kilo-instance.js";

const connection = { baseUrl: "http://127.0.0.1:4096", username: "kilo", password: "secret" };
const WORKTREE = "/repo/.kilo/worktrees/kilo-a";

type Emit = (event: unknown) => void;

function eventStream() {
	const queue: unknown[] = [];
	let wake: (() => void) | undefined;
	const emit: Emit = (event) => {
		queue.push(event);
		wake?.();
	};
	async function* stream(signal: AbortSignal) {
		while (!signal.aborted) {
			if (queue.length === 0) {
				await new Promise<void>((resolve) => {
					wake = resolve;
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				continue;
			}
			yield queue.shift();
		}
	}
	return { emit, stream };
}

function setup(options: { exposeServer?: boolean; onDispose?: (emit: Emit) => void } = {}) {
	const harness = createFakeSdk({ featureId: "test-harness" });
	const mainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: harness.services });
	if (options.exposeServer !== false) {
		const serverSdk = createFakeMainSdk({ featureId: "kilo-server", services: harness.services });
		serverSdk.plugins.expose("connectionService", { getConnection: async () => connection });
	}
	const events = eventStream();
	const calls: string[] = [];
	const event = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
		calls.push("subscribe");
		events.emit({ payload: { type: "server.connected", properties: {} } });
		return { stream: events.stream(signal) };
	});
	const dispose = vi.fn(async () => {
		calls.push("dispose");
		options.onDispose?.(events.emit);
		return { data: true };
	});
	const createClient = vi.fn(() => ({ global: { event }, instance: { dispose } }));
	return { mainSdk, calls, dispose, createClient };
}

const disposedEvent = (directory: string) => ({
	directory,
	payload: { type: "server.instance.disposed", properties: { directory } },
});

describe("createKiloInstanceDisposer", () => {
	it("subscribes, disposes, and waits for the server to announce this directory's disposal", async () => {
		let emitLater: Emit | undefined;
		const { mainSdk, calls, dispose, createClient } = setup({
			onDispose: (emit) => {
				emitLater = emit;
			},
		});

		let settled = false;
		const pending = createKiloInstanceDisposer(
			mainSdk,
			createClient as never,
			5_000,
		)(WORKTREE).then(() => {
			settled = true;
		});
		await vi.waitFor(() => expect(dispose).toHaveBeenCalled());
		emitLater?.(disposedEvent("/repo/.kilo/worktrees/kilo-other"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(settled).toBe(false);

		emitLater?.(disposedEvent(`${WORKTREE}/`));
		await pending;

		expect(calls).toEqual(["subscribe", "dispose"]);
		expect(createClient).toHaveBeenCalledWith({
			baseUrl: connection.baseUrl,
			headers: { Authorization: `Basic ${Buffer.from("kilo:secret").toString("base64")}` },
		});
		expect(dispose).toHaveBeenCalledWith({ directory: WORKTREE }, { throwOnError: true });
	});

	it("proceeds after the timeout when the disposal is never announced", async () => {
		const { mainSdk, dispose, createClient } = setup();

		await createKiloInstanceDisposer(mainSdk, createClient as never, 30)(WORKTREE);

		expect(dispose).toHaveBeenCalledOnce();
	});

	it("rejects when the Kilo server plugin is unavailable", async () => {
		const { mainSdk, createClient } = setup({ exposeServer: false });

		await expect(
			createKiloInstanceDisposer(mainSdk, createClient as never)(WORKTREE),
		).rejects.toThrow("Kilo Server is unavailable.");
		expect(createClient).not.toHaveBeenCalled();
	});
});
