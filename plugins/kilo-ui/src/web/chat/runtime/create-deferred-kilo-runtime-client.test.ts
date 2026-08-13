import { describe, expect, it } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import { createDeferredKiloRuntimeClient } from "./create-deferred-kilo-runtime-client.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("createDeferredKiloRuntimeClient", () => {
	it("waits for the client and reuses it across nested calls", async () => {
		const gate = deferred<KiloClient>();
		const create = async () => ({ data: { id: "session-1" } });
		const list = async () => ({ data: [] });
		const client = createDeferredKiloRuntimeClient(gate.promise);

		const pending = client.session.create({}, { throwOnError: true });
		gate.resolve({
			session: { create },
			experimental: { session: { list } },
		} as never);

		await expect(pending).resolves.toEqual({ data: { id: "session-1" } });
		await expect(
			client.experimental.session.list({ roots: true }, { throwOnError: true }),
		).resolves.toEqual({ data: [] });
	});

	it("propagates failures to callers", async () => {
		const error = new Error("Kilo failed to start");
		const client = createDeferredKiloRuntimeClient(Promise.reject(error));

		await expect(client.session.create({}, { throwOnError: true })).rejects.toThrow(error);
	});

	it("handles an unused rejected client promise", async () => {
		createDeferredKiloRuntimeClient(Promise.reject(new Error("Kilo failed to start")));
		await Promise.resolve();
		await Promise.resolve();
	});
});
