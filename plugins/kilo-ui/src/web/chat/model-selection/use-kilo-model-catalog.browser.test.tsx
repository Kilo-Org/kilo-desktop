import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import type { KiloProviderListPayload } from "./model-catalog.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { useKiloModelCatalog } from "./use-kilo-model-catalog.js";

const providerList = vi.hoisted(() => vi.fn());

vi.mock("../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		provider: { list: providerList },
	})),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
};

const payload: KiloProviderListPayload = {
	all: [
		{
			id: "anthropic",
			name: "Anthropic",
			models: {
				"claude-sonnet": {
					id: "claude-sonnet",
					name: "Claude Sonnet",
					providerID: "anthropic",
				},
			},
		},
	],
	default: { anthropic: "claude-sonnet" },
	connected: ["anthropic"],
};

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useKiloModelCatalog", () => {
	it("waits for a resolved connection and fetches the catalog once", async () => {
		providerList.mockResolvedValue({ data: payload });
		type Props = { connection: KiloGlobalConnection | undefined };
		const { result, rerender } = renderHook(
			({ connection: currentConnection }: Props) => useKiloModelCatalog(currentConnection),
			{
				initialProps: { connection: undefined } as Props,
				wrapper: createWrapper(),
			},
		);

		expect(result.current.fetchStatus).toBe("idle");
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();

		rerender({ connection });
		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(createKiloDirectoryClient).toHaveBeenCalledExactlyOnceWith(
			connection,
			connection.globalDirectory,
		);
		expect(providerList).toHaveBeenCalledOnce();

		rerender({ connection: { ...connection, globalDirectory: "/other" } });
		await Promise.resolve();
		expect(providerList).toHaveBeenCalledOnce();

		rerender({ connection: { ...connection, baseUrl: "http://127.0.0.1:5096" } });
		await vi.waitFor(() => expect(providerList).toHaveBeenCalledTimes(2));
	});
});
