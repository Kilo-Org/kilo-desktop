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

	it("uses the latest client when given a factory", async () => {
		const firstCreate = async () => ({ data: { id: "first" } });
		const secondCreate = async () => ({ data: { id: "second" } });
		let current: KiloClient = { session: { create: firstCreate } } as never;
		const client = createDeferredKiloRuntimeClient(async () => current);

		await expect(client.session.create({}, { throwOnError: true })).resolves.toEqual({
			data: { id: "first" },
		});
		current = { session: { create: secondCreate } } as never;
		await expect(client.session.create({}, { throwOnError: true })).resolves.toEqual({
			data: { id: "second" },
		});
	});

	it("rejects when a traversed property is not an object", async () => {
		const client = createDeferredKiloRuntimeClient(Promise.resolve({ session: 42 } as never));

		// Reaching through `session` (a number) to a further property must reject
		// because the resolved value is not traversable.
		await expect((client.session as { create: () => Promise<unknown> }).create()).rejects.toThrow(
			/is not an object/,
		);
	});

	it("rejects when a resolved property is called but is not a function", async () => {
		const client = createDeferredKiloRuntimeClient(
			Promise.resolve({ session: { create: {} } } as never),
		);

		await expect(client.session.create({}, { throwOnError: true })).rejects.toThrow(
			/is not a function/,
		);
	});

	it("invokes the root client with an undefined receiver", async () => {
		const rootCallable = Object.assign(async () => "root-result", {});
		const client = createDeferredKiloRuntimeClient(Promise.resolve(rootCallable as never));

		// Calling the root proxy directly exercises the apply path with no receiver.
		await expect((client as unknown as () => Promise<string>)()).resolves.toBe("root-result");
	});
});
