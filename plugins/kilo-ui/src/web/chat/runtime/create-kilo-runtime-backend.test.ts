import { afterEach, describe, expect, it, vi } from "vitest";
import { STREAM_RECONNECTED_EVENT_TYPE } from "@assistant-ui/react-opencode";
import { toast } from "@kilo-desktop/ui/components/sonner";
import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { LOCAL_MODEL_SERVER_PROVIDER_ID } from "../../providers/provider-ids.js";
import { createSessionActivityStore } from "../session-activity/session-activity-store.js";
import { createKiloSuggestionStore } from "../suggestions/kilo-suggestion-store.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { createKiloDirectoryClient, createKiloGlobalClient } from "./create-kilo-runtime-client.js";

vi.mock("./create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(),
	createKiloGlobalClient: vi.fn(),
}));

vi.mock("@kilo-desktop/ui/components/sonner", () => ({
	toast: { warning: vi.fn() },
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
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

describe("createKiloRuntimeBackend", () => {
	afterEach(() => {
		vi.useRealTimers();
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
					metadata: { "kilo-desktop": {} },
				},
				{
					id: "session-b",
					directory: "/workspace/b",
					title: "B",
					time: { created: 2, updated: 2 },
					metadata: { "kilo-desktop": { workspaceId: "ws-1" } },
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
		expect(create).toHaveBeenCalledWith(
			{ metadata: { "kilo-desktop": {} } },
			{ throwOnError: true },
		);

		backend.getSessionClient({ id: "session-new" });
		expect(createKiloDirectoryClient).toHaveBeenCalledOnce();
	});

	it("stamps workspace id inside nested kilo-desktop metadata", async () => {
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
					"kilo-desktop": {
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
					id: "session-archived",
					directory: "/workspace/archived",
					title: "Archived",
					time: { created: 10, updated: 20, archived: 30 },
					metadata: { "kilo-desktop": {} },
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
			expect(store.getState().sessions["session-archived"]).toMatchObject({
				directory: "/workspace/archived",
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

	it("shows a warning toast when the prepared worktree carries one", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/worktree",
			workspaceFolders: [],
			worktree: {
				branch: "kilo/aback-aardvark",
				warning: "Couldn't fetch latest main from origin; branched from local state.",
			},
		}));
		const create = vi.fn(async () => ({ data: { id: "session-warn" } }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getVariant: () => undefined,
		});

		await expect(backend.initializeSession()).resolves.toEqual({
			id: "session-warn",
			directory: "/workspace/worktree",
		});
		expect(toast.warning).toHaveBeenCalledWith(
			"Couldn't fetch latest main from origin; branched from local state.",
		);
	});

	it("hydrates workspace id and worktree branch together on session create", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/.kilo/worktrees/kilo-aback-aardvark",
			workspaceId: "ws-1",
			workspaceFolders: [
				{ path: "/workspace/.kilo/worktrees/kilo-aback-aardvark", isPrimary: true },
			],
			worktree: { branch: "kilo/aback-aardvark" },
		}));
		const create = vi.fn(async () => ({ data: { id: "session-wt" } }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const store = createSessionActivityStore({ storage: null });
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getVariant: () => undefined,
			sessionActivity: store,
		});

		await backend.initializeSession();

		expect(store.getState().sessions["session-wt"]).toMatchObject({
			directory: "/workspace/.kilo/worktrees/kilo-aback-aardvark",
			workspaceId: "ws-1",
			worktreeBranch: "kilo/aback-aardvark",
		});
	});

	it("shows no warning toast for a worktree without one", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/worktree",
			workspaceFolders: [],
			worktree: { branch: "kilo/aback-aardvark" },
		}));
		const create = vi.fn(async () => ({ data: { id: "session-clean" } }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getVariant: () => undefined,
		});

		await backend.initializeSession();

		expect(toast.warning).not.toHaveBeenCalled();
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
		const prepareSession = vi.fn(async () => ({ directory: "/workspace/x", workspaceFolders: [] }));
		const create = vi.fn(async () => ({ data: {} }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/Failed to create Kilo session/);
	});

	it("removes the prepared worktree when session creation rejects", async () => {
		const preparation = {
			directory: "/workspace/worktree",
			workspaceFolders: [],
			worktree: { branch: "kilo/aback-aardvark" },
		};
		const create = vi.fn(async () => {
			throw new Error("server unreachable");
		});
		const onSessionCreateFailed = vi.fn();
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(async () => preparation),
			onSessionCreateFailed,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/server unreachable/);
		expect(onSessionCreateFailed).toHaveBeenCalledWith(preparation);
	});

	it("removes the prepared worktree when session creation returns no session id", async () => {
		const preparation = {
			directory: "/workspace/worktree",
			workspaceFolders: [],
			worktree: { branch: "kilo/aback-aardvark" },
		};
		const create = vi.fn(async () => ({ data: {} }));
		const onSessionCreateFailed = vi.fn();
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(async () => preparation),
			onSessionCreateFailed,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/Failed to create Kilo session/);
		expect(onSessionCreateFailed).toHaveBeenCalledWith(preparation);
	});

	it("removes the prepared worktree when model preparation fails", async () => {
		const preparation = {
			directory: "/workspace/worktree",
			workspaceFolders: [],
			worktree: { branch: "kilo/aback-aardvark" },
		};
		const create = vi.fn(async () => ({ data: { id: "session-local" } }));
		const prepareModel = vi.fn(async () => {
			throw new Error("model not ready");
		});
		const onSessionCreateFailed = vi.fn();
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(async () => preparation),
			getModel: () => ({ providerID: LOCAL_MODEL_SERVER_PROVIDER_ID, modelID: "qwen-3" }),
			prepareModel,
			onSessionCreateFailed,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/model not ready/);
		expect(create).not.toHaveBeenCalled();
		expect(onSessionCreateFailed).toHaveBeenCalledWith(preparation);
	});

	it("does not fire the cleanup callback for a non-worktree preparation", async () => {
		const create = vi.fn(async () => {
			throw new Error("server unreachable");
		});
		const onSessionCreateFailed = vi.fn();
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(async () => ({
				directory: "/workspace/checkout",
				workspaceFolders: [],
			})),
			onSessionCreateFailed,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/server unreachable/);
		expect(onSessionCreateFailed).not.toHaveBeenCalled();
	});

	it("does not let a failing cleanup callback mask the original error", async () => {
		const create = vi.fn(async () => {
			throw new Error("server unreachable");
		});
		const onSessionCreateFailed = vi.fn(async () => {
			throw new Error("cleanup failed");
		});
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({ session: { create } } as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(async () => ({
				directory: "/workspace/worktree",
				workspaceFolders: [],
				worktree: { branch: "kilo/aback-aardvark" },
			})),
			onSessionCreateFailed,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/server unreachable/);
		expect(onSessionCreateFailed).toHaveBeenCalled();
	});

	it("rewrites a known slash prompt onto session.command after session create", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/slash",
			workspaceFolders: [],
		}));
		const create = vi.fn(async () => ({ data: { id: "session-slash" } }));
		const prompt = vi.fn(async () => ({ data: {} }));
		const command = vi.fn(async () => ({ data: {} }));
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({
			session: { create, prompt, command },
		} as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getAgent: () => "code",
			getKnownCommandNames: () => ["init", "compact"],
		});

		const ref = await backend.initializeSession();
		await backend.getSessionClient(ref).session.prompt({
			sessionID: ref.id,
			parts: [{ type: "text", text: "/init write AGENTS.md" }],
		});

		expect(prompt).not.toHaveBeenCalled();
		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "session-slash",
				command: "init",
				arguments: "write AGENTS.md",
				agent: "code",
			}),
		);
	});

	it("forwards agent and model prompt getters alongside the variant getter", async () => {
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/getters",
			workspaceFolders: [],
		}));
		const create = vi.fn(async () => ({ data: { id: "session-getters" } }));
		const prompt = vi.fn(async () => ({ data: {} }));
		const initialized = vi.fn();
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({
			session: { create, prompt },
		} as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getVariant: () => "variant",
			getAgent: () => "code",
			getModel: () => ({ providerID: "anthropic", modelID: "claude" }),
			onSessionInitialized: initialized,
		});

		const ref = await backend.initializeSession();
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				agent: "code",
				model: {
					id: "claude",
					providerID: "anthropic",
					variant: "variant",
				},
			}),
			expect.anything(),
		);
		expect(initialized).toHaveBeenCalledWith("session-getters");
		await backend.getSessionClient(ref).session.prompt({
			sessionID: ref.id,
			parts: [{ type: "text", text: "hello" }],
		});

		expect(prompt).toHaveBeenCalledWith(
			expect.objectContaining({
				variant: "variant",
				agent: "code",
				model: { providerID: "anthropic", modelID: "claude" },
			}),
		);
	});

	it("prepares a local model before creating the session and again before prompt", async () => {
		const order: string[] = [];
		const prepareSession = vi.fn(async () => ({
			directory: "/workspace/local",
			workspaceFolders: [],
		}));
		const create = vi.fn(async () => {
			order.push("create");
			return { data: { id: "session-local" } };
		});
		const prepareModel = vi.fn(async () => {
			order.push("prepare");
		});
		const prompt = vi.fn(async () => {
			order.push("prompt");
			return { data: {} };
		});
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({
			session: { create, prompt },
		} as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession,
			getModel: () => ({ providerID: "kilo-desktop-model-server", modelID: "qwen-3" }),
			prepareModel,
		});

		const ref = await backend.initializeSession();
		expect(order).toEqual(["prepare", "create"]);
		expect(prepareModel).toHaveBeenCalledWith("qwen-3");

		await backend.getSessionClient(ref).session.prompt({
			sessionID: ref.id,
			parts: [{ type: "text", text: "hello" }],
		});

		expect(order).toEqual(["prepare", "create", "prepare", "prompt"]);
	});

	it("does not create a local session when model preparation fails", async () => {
		const create = vi.fn(async () => ({ data: { id: "session-local" } }));
		const prepareModel = vi.fn(async () => {
			throw new Error("model not ready");
		});
		const onSessionCreateFailed = vi.fn();
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockReturnValue({
			session: { create },
		} as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: async () => ({
				directory: "/workspace/local",
				workspaceFolders: [],
			}),
			getModel: () => ({ providerID: "kilo-desktop-model-server", modelID: "qwen-3" }),
			prepareModel,
			onSessionCreateFailed,
		});

		await expect(backend.initializeSession()).rejects.toThrow(/model not ready/);
		expect(create).not.toHaveBeenCalled();
		// The checkout preparation owns nothing to clean up.
		expect(onSessionCreateFailed).not.toHaveBeenCalled();
	});

	it("creates a local session on the current Kilo connection after a slow prepare", async () => {
		const restarted: KiloGlobalConnection = {
			...connection,
			baseUrl: "http://127.0.0.1:5096",
		};
		let current = Promise.resolve(connection);
		const gate = deferred<void>();
		const createdOn = vi.fn();
		const prepareModel = vi.fn(async () => {
			await gate.promise;
		});
		vi.mocked(createKiloGlobalClient).mockReturnValue({} as never);
		vi.mocked(createKiloDirectoryClient).mockImplementation((next) => {
			return {
				session: {
					create: async () => {
						createdOn(next.baseUrl);
						return { data: { id: "session-local" } };
					},
				},
			} as never;
		});
		const backend = createKiloRuntimeBackend({
			getConnection: () => current,
			prepareSession: async () => ({
				directory: "/workspace/local",
				workspaceFolders: [],
			}),
			getModel: () => ({ providerID: "kilo-desktop-model-server", modelID: "qwen-3" }),
			prepareModel,
		});

		const pending = backend.initializeSession();
		await vi.waitFor(() => expect(prepareModel).toHaveBeenCalledOnce());
		current = Promise.resolve(restarted);
		gate.resolve();

		await expect(pending).resolves.toEqual({
			id: "session-local",
			directory: "/workspace/local",
		});
		expect(createdOn).toHaveBeenCalledWith("http://127.0.0.1:5096");
	});

	it("recreates cached clients when Kilo rotates credentials on the same endpoint", async () => {
		const restarted = { ...connection, password: "rotated-secret" };
		let current = Promise.resolve(connection);
		const globalList = vi.fn<(password: string) => void>();
		const directoryGet = vi.fn<(password: string) => void>();
		vi.mocked(createKiloGlobalClient).mockImplementation((next) => {
			return {
				experimental: {
					session: {
						list: async () => {
							globalList(next.password);
							return { data: [] };
						},
					},
				},
			} as never;
		});
		vi.mocked(createKiloDirectoryClient).mockImplementation((next) => {
			return {
				session: {
					get: async () => {
						directoryGet(next.password);
						return { data: {} };
					},
				},
			} as never;
		});
		const backend = createKiloRuntimeBackend({
			getConnection: () => current,
			prepareSession: vi.fn(),
		});
		const sessionClient = backend.getSessionClient({
			id: "rotating-session",
			directory: "/workspace/rotating",
		});

		await backend.globalClient.experimental.session.list({}, { throwOnError: true });
		await sessionClient.session.get({ sessionID: "rotating-session" }, { throwOnError: true });
		current = Promise.resolve(restarted);
		await backend.globalClient.experimental.session.list({}, { throwOnError: true });
		await sessionClient.session.get({ sessionID: "rotating-session" }, { throwOnError: true });

		expect(globalList.mock.calls).toEqual([["secret"], ["rotated-secret"]]);
		expect(directoryGet.mock.calls).toEqual([["secret"], ["rotated-secret"]]);
		expect(createKiloGlobalClient).toHaveBeenCalledTimes(2);
		expect(createKiloDirectoryClient).toHaveBeenCalledTimes(2);
	});

	it("bounds session listing and retries once against the current live connection", async () => {
		vi.useFakeTimers();
		const restarted = { ...connection, password: "rotated-secret" };
		let current = Promise.resolve(connection);
		const firstList = vi.fn(() => new Promise(() => undefined));
		const secondList = vi.fn(async () => ({ data: [] }));
		vi.mocked(createKiloGlobalClient).mockImplementation((next) => {
			return {
				experimental: {
					session: { list: next === connection ? firstList : secondList },
				},
			} as never;
		});
		const backend = createKiloRuntimeBackend({
			getConnection: () => current,
			prepareSession: vi.fn(),
		});

		const listing = backend.globalClient.experimental.session.list({}, { throwOnError: true });
		await vi.advanceTimersByTimeAsync(0);
		expect(firstList).toHaveBeenCalledOnce();
		current = Promise.resolve(restarted);
		await vi.advanceTimersByTimeAsync(10_000);

		await expect(listing).resolves.toEqual({ data: [] });
		expect(secondList).toHaveBeenCalledOnce();
		expect(createKiloGlobalClient).toHaveBeenCalledTimes(2);
	});

	it("rejects session listing after the bounded retry also times out", async () => {
		vi.useFakeTimers();
		const list = vi.fn(() => new Promise(() => undefined));
		vi.mocked(createKiloGlobalClient).mockReturnValue({
			experimental: { session: { list } },
		} as never);
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
		});

		const listing = backend.globalClient.experimental.session.list({}, { throwOnError: true });
		const rejection = expect(listing).rejects.toThrow(/timed out/i);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(10_000);
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(10_000);

		await rejection;
		expect(list).toHaveBeenCalledTimes(2);
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

	it("applies streamed suggestion events into the suggestion store", async () => {
		const event = vi.fn(async () => ({
			stream: (async function* () {
				yield {
					payload: {
						type: "suggestion.shown",
						properties: {
							id: "sug-1",
							sessionID: "ses-1",
							text: "Run a local review?",
							actions: [{ label: "Start review", prompt: "/local-review-uncommitted" }],
						},
					},
				};
				await new Promise(() => undefined);
			})(),
		}));
		vi.mocked(createKiloGlobalClient).mockReturnValue({
			global: { event },
			experimental: { session: { list: vi.fn(async () => ({ data: [] })) } },
			suggestion: { list: vi.fn(async () => ({ data: [] })) },
		} as never);
		const suggestions = createKiloSuggestionStore();
		const backend = createKiloRuntimeBackend({
			connectionPromise: Promise.resolve(connection),
			prepareSession: vi.fn(),
			suggestions,
		});

		const source = backend.createEventSource();
		source.subscribe(() => undefined);

		await vi.waitFor(() => expect(suggestions.getState().pending).toHaveLength(1));
		expect(suggestions.getState().pending[0]?.id).toBe("sug-1");
	});
});
