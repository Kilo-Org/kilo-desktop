import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCodeAttachmentAdapter, useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createSessionActivityStore } from "../session-activity/session-activity-store.js";
import { createKiloSuggestionStore } from "../suggestions/kilo-suggestion-store.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { useKiloRuntime } from "./use-kilo-runtime.js";

vi.mock("@assistant-ui/react-opencode", () => ({
	OpenCodeAttachmentAdapter: vi.fn(function OpenCodeAttachmentAdapter() {
		return { accept: "image/png,text/plain" };
	}),
	useOpenCodeRuntime: vi.fn(() => ({ source: "kilo-test-runtime" })),
}));

vi.mock("./create-kilo-runtime-backend.js", () => ({
	createKiloRuntimeBackend: vi.fn(() => ({ globalClient: {} })),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
};

describe("useKiloRuntime", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("creates one backend and forwards runtime options", () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		const onError = vi.fn();
		const onSessionInitialized = vi.fn();

		renderHook(() =>
			useKiloRuntime({
				connectionPromise,
				prepareSession,
				defaultModel: { providerID: "anthropic", modelID: "claude-sonnet" },
				onError,
				onSessionInitialized,
			}),
		);

		expect(createKiloRuntimeBackend).toHaveBeenCalledOnce();
		expect(createKiloRuntimeBackend).toHaveBeenCalledWith({
			getConnection: expect.any(Function),
			prepareSession,
			getVariant: expect.any(Function),
			getAgent: expect.any(Function),
			getModel: expect.any(Function),
			prepareModel: expect.any(Function),
			getKnownCommandNames: expect.any(Function),
			onSessionInitialized: expect.any(Function),
		});
		vi.mocked(createKiloRuntimeBackend).mock.calls[0]?.[0].onSessionInitialized?.("session-1");
		expect(onSessionInitialized).toHaveBeenCalledWith("session-1");
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({
			backend: expect.objectContaining({ globalClient: {} }),
			defaultModel: { providerID: "anthropic", modelID: "claude-sonnet" },
			onError,
			messageQueue: { cancelBehavior: "pause" },
			adapters: { attachments: expect.objectContaining({ accept: "image/png,text/plain" }) },
		});
		expect(OpenCodeAttachmentAdapter).toHaveBeenCalledOnce();
	});

	it("keeps the same backend when the connection promise identity changes", async () => {
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		const first = Promise.resolve(connection);
		const second = Promise.resolve({
			...connection,
			baseUrl: "http://127.0.0.1:5096",
		});

		const { rerender } = renderHook(
			({ connectionPromise }: { connectionPromise: Promise<KiloGlobalConnection> }) =>
				useKiloRuntime({
					connectionPromise,
					prepareSession,
				}),
			{ initialProps: { connectionPromise: first } },
		);

		expect(createKiloRuntimeBackend).toHaveBeenCalledOnce();
		rerender({ connectionPromise: second });
		expect(createKiloRuntimeBackend).toHaveBeenCalledOnce();
		await expect(
			vi.mocked(createKiloRuntimeBackend).mock.calls[0]?.[0].getConnection?.(),
		).resolves.toEqual(expect.objectContaining({ baseUrl: "http://127.0.0.1:5096" }));
	});

	it("keeps the same backend while the session initialized callback changes presence", () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		const callback = vi.fn();
		type Props = { onSessionInitialized: ((threadId: string) => void) | undefined };

		const { rerender } = renderHook(
			({ onSessionInitialized }: Props) =>
				useKiloRuntime({
					connectionPromise,
					prepareSession,
					...(onSessionInitialized ? { onSessionInitialized } : {}),
				}),
			{ initialProps: { onSessionInitialized: undefined } as Props },
		);

		const backendArgs = vi.mocked(createKiloRuntimeBackend).mock.calls[0]?.[0];
		backendArgs?.onSessionInitialized?.("ignored-session");
		rerender({ onSessionInitialized: callback });
		backendArgs?.onSessionInitialized?.("session-1");
		rerender({ onSessionInitialized: undefined });
		backendArgs?.onSessionInitialized?.("also-ignored-session");

		expect(createKiloRuntimeBackend).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledExactlyOnceWith("session-1");
	});

	it("forwards live agent and model getters that track selection changes", () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));

		const { rerender } = renderHook(
			({ agent, model }: { agent: string; model: { providerID: string; modelID: string } }) =>
				useKiloRuntime({
					connectionPromise,
					prepareSession,
					defaultAgent: agent,
					defaultModel: model,
				}),
			{
				initialProps: {
					agent: "code",
					model: { providerID: "anthropic", modelID: "claude-sonnet" },
				},
			},
		);

		const backendArgs = vi.mocked(createKiloRuntimeBackend).mock.calls[0]?.[0];
		expect(backendArgs?.getAgent?.()).toBe("code");
		expect(backendArgs?.getModel?.()).toEqual({
			providerID: "anthropic",
			modelID: "claude-sonnet",
		});

		rerender({
			agent: "plan",
			model: { providerID: "openai", modelID: "gpt-5" },
		});

		expect(backendArgs?.getAgent?.()).toBe("plan");
		expect(backendArgs?.getModel?.()).toEqual({
			providerID: "openai",
			modelID: "gpt-5",
		});
		// Backend is created once; getters read refs so selection stays live.
		expect(createKiloRuntimeBackend).toHaveBeenCalledOnce();
	});

	it("uses an explicit synchronous agent getter for prompt dispatch", () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		let selectedAgent = "plan";

		renderHook(() =>
			useKiloRuntime({
				connectionPromise,
				prepareSession,
				defaultAgent: selectedAgent,
				getAgent: () => selectedAgent,
			}),
		);

		const backendArgs = vi.mocked(createKiloRuntimeBackend).mock.calls[0]?.[0];
		selectedAgent = "code";

		expect(backendArgs?.getAgent?.()).toBe("code");
	});

	it("forwards local model preparation into the runtime backend", async () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		const prepareModel = vi.fn(async () => undefined);

		renderHook(() =>
			useKiloRuntime({
				connectionPromise,
				prepareSession,
				prepareModel,
			}),
		);

		const forwarded = vi.mocked(createKiloRuntimeBackend).mock.calls[0]?.[0];
		expect(forwarded).toEqual(
			expect.objectContaining({
				getConnection: expect.any(Function),
				prepareSession,
				prepareModel: expect.any(Function),
				getVariant: expect.any(Function),
				getAgent: expect.any(Function),
				getModel: expect.any(Function),
			}),
		);
		await forwarded?.prepareModel?.("qwen-3");
		expect(prepareModel).toHaveBeenCalledWith("qwen-3");
	});

	it("accepts an injected client for focused tests", () => {
		const client = { session: {} } as KiloClient;

		renderHook(() => useKiloRuntime({ client }));

		expect(createKiloRuntimeBackend).not.toHaveBeenCalled();
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({
			client: expect.anything(),
			messageQueue: { cancelBehavior: "pause" },
			adapters: { attachments: expect.objectContaining({ accept: "image/png,text/plain" }) },
		});
	});

	it("forwards sessionActivity and suggestions into the backend", () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		const sessionActivity = createSessionActivityStore({ storage: null });
		const suggestions = createKiloSuggestionStore();

		renderHook(() =>
			useKiloRuntime({
				connectionPromise,
				prepareSession,
				sessionActivity,
				suggestions,
			}),
		);

		expect(createKiloRuntimeBackend).toHaveBeenCalledWith({
			getConnection: expect.any(Function),
			prepareSession,
			getVariant: expect.any(Function),
			getAgent: expect.any(Function),
			getModel: expect.any(Function),
			prepareModel: expect.any(Function),
			getKnownCommandNames: expect.any(Function),
			onSessionInitialized: expect.any(Function),
			sessionActivity,
			suggestions,
		});
	});

	it("throws when neither a client nor connectionPromise with prepareSession is provided", () => {
		expect(() => renderHook(() => useKiloRuntime({}))).toThrow(
			"useKiloRuntime requires a client, or connectionPromise with prepareSession",
		);
	});
});
