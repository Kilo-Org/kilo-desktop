import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeferredKiloRuntimeClient } from "./create-deferred-kilo-runtime-client.js";
import { createKiloRuntimeClient } from "./create-kilo-runtime-client.js";

vi.mock("./create-kilo-runtime-client.js", () => ({
	createKiloRuntimeClient: vi.fn(),
}));

const connection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	directory: "/workspaces/kilo",
};

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
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("keeps a stable identity and does not create the real client until used", async () => {
		const gate = deferred<typeof connection>();
		const create = vi.fn(async () => ({ data: { id: "session-1" } }));
		const realClient = {
			session: { create },
		};
		vi.mocked(createKiloRuntimeClient).mockReturnValue(realClient as never);

		const client = createDeferredKiloRuntimeClient(gate.promise);
		const again = client;
		expect(again).toBe(client);
		expect(createKiloRuntimeClient).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();

		const pending = client.session.create({}, { throwOnError: true });
		expect(createKiloRuntimeClient).not.toHaveBeenCalled();

		gate.resolve(connection);
		await expect(pending).resolves.toEqual({ data: { id: "session-1" } });
		expect(createKiloRuntimeClient).toHaveBeenCalledExactlyOnceWith(connection);
		expect(create).toHaveBeenCalledOnce();
	});

	it("reuses one resolved client across nested calls", async () => {
		const list = vi.fn(async () => ({ data: [] }));
		const create = vi.fn(async () => ({ data: { id: "session-1" } }));
		vi.mocked(createKiloRuntimeClient).mockReturnValue({
			experimental: { session: { list } },
			session: { create },
		} as never);

		const client = createDeferredKiloRuntimeClient(Promise.resolve(connection));
		await client.experimental.session.list({ roots: true }, { throwOnError: true });
		await client.session.create({}, { throwOnError: true });

		expect(createKiloRuntimeClient).toHaveBeenCalledOnce();
		expect(list).toHaveBeenCalledOnce();
		expect(create).toHaveBeenCalledOnce();
	});

	it("propagates connection failures to callers", async () => {
		const error = new Error("Kilo failed to start");
		const client = createDeferredKiloRuntimeClient(Promise.reject(error));

		await expect(client.session.create({}, { throwOnError: true })).rejects.toThrow(error);
		expect(createKiloRuntimeClient).not.toHaveBeenCalled();
	});

	it("does not report an unhandled rejection when the connection fails unused", async () => {
		const error = new Error("Kilo failed to start");
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);

		try {
			createDeferredKiloRuntimeClient(Promise.reject(error));
			await Promise.resolve();
			await Promise.resolve();
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("retargets to a new connection without changing client identity", async () => {
		const create = vi.fn(async () => ({ data: { id: "session-2" } }));
		vi.mocked(createKiloRuntimeClient).mockReturnValue({ session: { create } } as never);

		const first = deferred<typeof connection>();
		const client = createDeferredKiloRuntimeClient(first.promise);
		const retargeted = {
			...connection,
			directory: "/workspaces/other",
		};
		const second = Promise.resolve(retargeted);
		client.retarget(second);

		expect(client.retarget).toEqual(expect.any(Function));

		const pending = client.session.create({}, { throwOnError: true });
		await expect(pending).resolves.toEqual({ data: { id: "session-2" } });
		expect(createKiloRuntimeClient).toHaveBeenCalledExactlyOnceWith(retargeted);
		expect(create).toHaveBeenCalledOnce();
		// Original promise left unresolved — must not affect the retargeted client.
		expect(first.promise).toBeInstanceOf(Promise);
	});
});
