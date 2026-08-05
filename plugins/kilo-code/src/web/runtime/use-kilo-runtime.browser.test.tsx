import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenCodeRuntime } from "@assistant-ui/react-opencode";
import { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloWorkspaceConnection } from "../../contracts/schemas.js";
import { useKiloRuntime } from "./use-kilo-runtime.js";

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeRuntime: vi.fn(() => ({ source: "kilo-test-runtime" })),
}));

const connection: KiloWorkspaceConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	directory: "/workspaces/kilo",
};

function latestInjectedClient() {
	const lastCall = vi.mocked(useOpenCodeRuntime).mock.lastCall;
	if (!lastCall) {
		throw new Error("Expected useOpenCodeRuntime to have been called");
	}
	const [options] = lastCall;
	if (!options) {
		throw new Error("Expected useOpenCodeRuntime options");
	}
	return options.client;
}

describe("useKiloRuntime", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("injects a Kilo client and forwards runtime options", () => {
		const onError = vi.fn();

		renderHook(() =>
			useKiloRuntime({
				connection,
				initialSessionId: "session-1",
				defaultAgent: "build",
				defaultModel: {
					providerID: "anthropic",
					modelID: "claude-sonnet",
				},
				onError,
			}),
		);

		expect(useOpenCodeRuntime).toHaveBeenCalledOnce();
		expect(useOpenCodeRuntime).toHaveBeenCalledWith({
			client: expect.any(KiloClient),
			initialSessionId: "session-1",
			defaultAgent: "build",
			defaultModel: {
				providerID: "anthropic",
				modelID: "claude-sonnet",
			},
			onError,
		});
	});

	it("retains the client for equivalent connections and ignores server version changes", () => {
		const { rerender } = renderHook(
			({ currentConnection }: { currentConnection: KiloWorkspaceConnection }) =>
				useKiloRuntime({ connection: currentConnection }),
			{ initialProps: { currentConnection: connection } },
		);
		const initialClient = latestInjectedClient();

		rerender({
			currentConnection: {
				...connection,
				version: "7.4.21",
			},
		});

		const nextClient = latestInjectedClient();
		expect(nextClient).toBe(initialClient);
	});

	it.each([
		["base URL", { baseUrl: "http://127.0.0.1:5096" }],
		["directory", { directory: "/workspaces/another" }],
		["username", { username: "another-user" }],
		["password", { password: "another-password" }],
	])("recreates the client when the %s changes", (_, change) => {
		const { rerender } = renderHook(
			({ currentConnection }: { currentConnection: KiloWorkspaceConnection }) =>
				useKiloRuntime({ connection: currentConnection }),
			{ initialProps: { currentConnection: connection } },
		);
		const initialClient = latestInjectedClient();

		rerender({ currentConnection: { ...connection, ...change } });

		const nextClient = latestInjectedClient();
		expect(nextClient).toBeInstanceOf(KiloClient);
		expect(nextClient).not.toBe(initialClient);
	});
});
