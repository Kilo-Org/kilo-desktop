import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createSessionActivityStore } from "../session-activity/session-activity-store.js";
import { createKiloRuntimeBackend } from "./create-kilo-runtime-backend.js";
import { useKiloRuntime } from "./use-kilo-runtime.js";

vi.mock("@assistant-ui/react-opencode", () => ({
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

		renderHook(() =>
			useKiloRuntime({
				connectionPromise,
				prepareSession,
				defaultModel: { providerID: "anthropic", modelID: "claude-sonnet" },
				onError,
			}),
		);

		expect(createKiloRuntimeBackend).toHaveBeenCalledOnce();
		expect(createKiloRuntimeBackend).toHaveBeenCalledWith({
			connectionPromise,
			prepareSession,
			getVariant: expect.any(Function),
			getAgent: expect.any(Function),
			getModel: expect.any(Function),
		});
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({
			backend: expect.objectContaining({ globalClient: {} }),
			defaultModel: { providerID: "anthropic", modelID: "claude-sonnet" },
			onError,
		});
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

	it("accepts an injected client for focused tests", () => {
		const client = { session: {} } as KiloClient;

		renderHook(() => useKiloRuntime({ client }));

		expect(createKiloRuntimeBackend).not.toHaveBeenCalled();
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({ client: expect.anything() });
	});

	it("forwards sessionActivity into the backend", () => {
		const connectionPromise = Promise.resolve(connection);
		const prepareSession = vi.fn(async () => ({ directory: "/workspace", workspaceFolders: [] }));
		const sessionActivity = createSessionActivityStore({ storage: null });

		renderHook(() =>
			useKiloRuntime({
				connectionPromise,
				prepareSession,
				sessionActivity,
			}),
		);

		expect(createKiloRuntimeBackend).toHaveBeenCalledWith({
			connectionPromise,
			prepareSession,
			getVariant: expect.any(Function),
			getAgent: expect.any(Function),
			getModel: expect.any(Function),
			sessionActivity,
		});
	});

	it("throws when neither a client nor connectionPromise with prepareSession is provided", () => {
		expect(() => renderHook(() => useKiloRuntime({}))).toThrow(
			"useKiloRuntime requires a client, or connectionPromise with prepareSession",
		);
	});
});
