import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
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
		const prepareSession = vi.fn(async () => ({ directory: "/workspace" }));
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
		});
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({
			backend: expect.objectContaining({ globalClient: {} }),
			defaultModel: { providerID: "anthropic", modelID: "claude-sonnet" },
			onError,
		});
	});

	it("accepts an injected client for focused tests", () => {
		const client = { session: {} } as KiloClient;

		renderHook(() => useKiloRuntime({ client }));

		expect(createKiloRuntimeBackend).not.toHaveBeenCalled();
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({ client: expect.anything() });
	});
});
