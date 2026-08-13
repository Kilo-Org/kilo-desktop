import { afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_RECONNECTED_EVENT_TYPE } from "@assistant-ui/react-opencode";
import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createSessionActivityStore } from "../session-activity/session-activity-store.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";
import { workspaceFolders } from "../../../main/workspaces/schema.js";

vi.mock("./create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(),
	createKiloGlobalClient: vi.fn(),
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
					metadata: { anaconda: {} },
				},
				{
					id: "session-b",
					directory: "/workspace/b",
					title: "B",
					time: { created: 2, updated: 2 },
					metadata: { anaconda: { workspaceId: "ws-1" } },
				},
				{
					id: "session-cli",
					directory: "/elsewhere",
					title: "CLI",
					time: { created: 3, updated: 3 },
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

		const listed = await backend.globalClient.experimental.session.list(
			{ roots: true, archived: true },
			{ throwOnError: true },
		);
		expect(listed.data?.map((session) => session.id)).toEqual(["session-a", "session-b"]);
	});

	it("creates a session only after preparation and keeps its directory immutable", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/selected",
			workspaceFolders: [],
		}));
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
		expect(create).toHaveBeenCalledWith({ metadata: { anaconda: {} } }, { throwOnError: true });

		backend.getSessionClient({ id: "session-new" });
		expect(createKiloDirectoryClient).toHaveBeenCalledOnce();
	});

	it("stamps workspace id inside nested anaconda metadata", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/selected",
			workspaceId: "ws-1",
			workspaceFolders: [
				{ path: "/workspace/selected", isPrimary: true },
				{ path: "/workspace/reference", isPrimary: false },
			],
		}));
		const create = vi.fn(async () => ({ data: { id: "session-ws" } }));
		const prompt = vi.fn(async () => ({ data: {} }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create, prompt } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getVariant: () => undefined,
		});

		await expect(backend.initializeSession()).resolves.toEqual({
			id: "session-ws",
			directory: "/workspace/selected",
		});
		expect(create).toHaveBeenCalledWith(
			{
				metadata: {
					anaconda: {
						workspaceId: "ws-1",
						workspaceFolders: [
							{ path: "/workspace/selected", isPrimary: true },
							{ path: "/workspace/reference", isPrimary: false },
						],
					},
				},
				permission: [
					{
						permission: "external_directory",
						pattern: "/workspace/reference",
						action: "allow",
					},
					{
						permission: "external_directory",
						pattern: "/workspace/reference/*",
						action: "allow",
					},
				],
			},
			{ throwOnError: true },
		);

		await backend.getSessionClient({ id: "session-ws" }).session.prompt({
			sessionID: "session-ws",
			parts: [{ type: "text", text: "Find the shared code." }],
		});
		expect(prompt).toHaveBeenCalledWith(
			expect.objectContaining({
				system: expect.stringMatching(
					/Primary folder.*\/workspace\/selected[\s\S]*Additional workspace folder.*\/workspace\/reference/,
				),
			}),
		);
	});

	it("hydrates session timestamps into the activity store at startup", async () => {
		const list = vi.fn(async () => ({
			data: [
				{
					id: "session-settled",
					directory: "/workspace/settled",
					title: "Settled",
					time: { created: 10, updated: 20, archived: 30 },
					metadata: { anaconda: {} },
				},
				{
					id: "session-cli",
					directory: "/cli",
					title: "CLI",
					time: { created: 11, updated: 21 },
				},
			],
		}));
		vi.mocked(createKiloGlobalClient).mockReturnValue({
			experimental: { session: { list } },
			permission: { list: vi.fn(async () => ({ data: [] })) },
			question: { list: vi.fn(async () => ({ data: [] })) },
			session: { status: vi.fn(async () => ({ data: {} })) },
		} as never);
		const store = createSessionActivityStore({ storage: null });

		createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
			getVariant: () => undefined,
			sessionActivity: store,
		});

		await vi.waitFor(() => {
			expect(store.getState().sessions["session-settled"]).toMatchObject({
				directory: "/workspace/settled",
				createdAt: 10,
				updatedAt: 20,
			});
		});
		expect(store.getState().sessions["session-cli"]).toBeUndefined();
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

	it("throws when a session directory cannot be resolved from the global list", async () => {
		const list = vi.fn(async () => ({ data: [] }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({
			experimental: { session: { list } },
		} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { get: vi.fn() } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
		});

		await expect(
			backend
				.getSessionClient({ id: "missing-session" })
				.session.get({ sessionID: "missing-session" }, { throwOnError: true }),
		).rejects.toThrow(/Could not resolve the directory for Kilo session missing-session/);
	});

	it("reuses a cached session client on repeated lookups of the same id", async () => {
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: {} } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
		});

		const first = backend.getSessionClient({ id: "cached", directory: "/workspace/cached" });
		const second = backend.getSessionClient({ id: "cached", directory: "/workspace/cached" });

		expect(second).toBe(first);
	});

	it("throws when session creation returns no session id", async () => {
		const prepareSession = vi.fn(async () => ({ directory: "/workspace/x", workspaceFolders }));
		const create = vi.fn(async () => ({ data: {} }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/Failed to create Kilo session/);
	});

	it("forwards agent and model prompt getters alongside the variant getter", async () => {
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({
			session: { create: vi.fn(async () => ({ data: { id: "session-getters" } })) },
		} as never);

		expect(() =>
			createKiloRuntimeBackend({
				connectionPromise: Promise.resolve(connection),
				prepareSession: vi.fn(),
				getVariant: () => "variant",
				getAgent: () => "code",
				getModel: () => ({ providerID: "anthropic", modelID: "claude" }),
			}),
		).not.toThrow();
	});

	it("applies streamed events into the activity store and re-hydrates on reconnect", async () => {
		const list = vi.fn(async () => ({ data: [] }));
		const event = vi.fn(async () => ({
			stream: (async function* () {
				// A reconnect marker triggers a re-hydrate; a normal event is applied.
				yield {
					payload: { type: STREAM_RECONNECTED_EVENT_TYPE },
				};
				yield {
					directory: "/workspace/events",
					payload: {
						type: "session.updated",
						properties: { info: { id: "session-events" } },
					},
				};
				await new Promise(() => undefined);
			})(),
		}));
		vi.mocked(createKiloGlobalClient).mockReturnValue({
			global: { event },
			experimental: { session: { list } },
			permission: { list: vi.fn(async () => ({ data: [] })) },
			question: { list: vi.fn(async () => ({ data: [] })) },
			session: { status: vi.fn(async () => ({ data: {} })) },
		} as never);
		const store = createSessionActivityStore({ storage: null });
		const applySpy = vi.spyOn(store.getState(), "applyEvent");
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
			sessionActivity: store,
		});

		const source = backend.createEventSource();
		source.subscribe(() => undefined);

		// The reconnect marker flows through the re-hydrate branch (no applyEvent),
		// and the normal event is applied to the store.
		await vi.waitFor(() =>
			expect(applySpy).toHaveBeenCalledWith(
				expect.objectContaining({ type: "session.updated", sessionId: "session-events" }),
			),
		);
		expect(applySpy).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: STREAM_RECONNECTED_EVENT_TYPE }),
		);
	});
});
