import { afterEach, describe, expect, it, vi } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";

vi.mock("./create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(),
	createKiloGlobalClient: vi.fn(),
}));

vi.mock("./with-prompt-variant.js", () => ({
	withPromptVariant: (client: KiloClient) => client,
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
};

describe("createKiloRuntimeBackend", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("resolves existing sessions from the global list and routes them by directory", async () => {
		const list = vi.fn(async () => ({
			data: [
				{
					id: "session-a",
					directory: "/workspace/a",
					title: "A",
					time: { created: 1, updated: 1 },
				},
				{
					id: "session-b",
					directory: "/workspace/b",
					title: "B",
					time: { created: 2, updated: 2 },
				},
			],
		}));
		vi.mocked(createKiloGlobalClient).mockReturnValue({
			experimental: { session: { list } },
		} as never);
		const get = vi.fn(async () => ({ data: { id: "session-a" } }));
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { get } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
			getVariant: () => undefined,
		});

		await backend
			.getSessionClient({ id: "session-a" })
			.session.get({ sessionID: "session-a" }, { throwOnError: true });
		await backend
			.getSessionClient({ id: "session-b" })
			.session.get({ sessionID: "session-b" }, { throwOnError: true });

		expect(list).toHaveBeenCalledWith({ roots: true, archived: true }, { throwOnError: true });
		expect(createKiloDirectoryClient).toHaveBeenNthCalledWith(1, connection, "/workspace/a");
		expect(createKiloDirectoryClient).toHaveBeenNthCalledWith(2, connection, "/workspace/b");
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("creates a session only after preparation and keeps its directory immutable", async () => {
		const prepareSession = vi.fn(async () => ({ directory: "/workspace/selected" }));
		const create = vi.fn(async () => ({ data: { id: "session-new" } }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getVariant: () => undefined,
		});

		expect(prepareSession).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		await expect(backend.initializeSession()).resolves.toEqual({
			id: "session-new",
			directory: "/workspace/selected",
		});
		expect(prepareSession).toHaveBeenCalledOnce();
		expect(createKiloDirectoryClient).toHaveBeenCalledWith(connection, "/workspace/selected");
		expect(create).toHaveBeenCalledOnce();

		backend.getSessionClient({ id: "session-new" });
		expect(createKiloDirectoryClient).toHaveBeenCalledOnce();
	});

	it("subscribes through the global event endpoint", async () => {
		let eventCallOptions: { signal?: AbortSignal } | undefined;
		const event = vi.fn(async (options: { signal?: AbortSignal }) => {
			eventCallOptions = options;
			return {
				stream: (async function* () {
					yield {
						directory: "/workspace/events",
						payload: {
							type: "session.updated",
							properties: { info: { id: "session-events" } },
						},
					};
					await new Promise<void>((resolve) => {
						options.signal?.addEventListener("abort", () => resolve(), { once: true });
					});
				})(),
			};
		});
		vi.mocked(createKiloGlobalClient).mockReturnValue({ global: { event } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
			getVariant: () => undefined,
		});
		const source = backend.createEventSource();
		const listener = vi.fn();
		const unsubscribe = source.subscribe(listener);

		await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
		expect(event).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session.updated",
				sessionId: "session-events",
				directory: "/workspace/events",
			}),
		);
		unsubscribe();
		expect(eventCallOptions?.signal?.aborted).toBe(true);
	});
});
