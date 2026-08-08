import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenCodeRuntime, type OpenCodeRuntimeBackend } from "@assistant-ui/react-opencode";
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

	it("accepts injected backends and clients for focused tests", () => {
		const backend = { globalClient: {} } as OpenCodeRuntimeBackend;
		const client = { session: {} } as KiloClient;

		const { rerender } = renderHook(
			({ injectedBackend }: { injectedBackend: OpenCodeRuntimeBackend | undefined }) =>
				useKiloRuntime(injectedBackend ? { backend: injectedBackend } : { client }),
			{ initialProps: { injectedBackend: backend as OpenCodeRuntimeBackend | undefined } },
		);
		expect(useOpenCodeRuntime).toHaveBeenLastCalledWith({ backend });

		rerender({ injectedBackend: undefined });
		expect(useOpenCodeRuntime).toHaveBeenLastCalledWith({ client: expect.anything() });
	});
});
