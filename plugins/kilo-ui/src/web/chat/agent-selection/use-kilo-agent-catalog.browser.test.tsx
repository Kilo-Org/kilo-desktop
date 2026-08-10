import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import { useKiloAgentCatalog } from "./use-kilo-agent-catalog.js";

const agentsList = vi.hoisted(() => vi.fn());

vi.mock("../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		app: { agents: agentsList },
	})),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
};

const payload: Agent[] = [
	{
		name: "code",
		displayName: "Code",
		mode: "primary",
		permission: [],
		options: {},
	},
	{
		name: "explore",
		mode: "subagent",
		permission: [],
		options: {},
	},
];

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

describe("useKiloAgentCatalog", () => {
	it("waits for a resolved connection and fetches selectable agents once", async () => {
		agentsList.mockResolvedValue({ data: payload });
		type Props = { connection: KiloGlobalConnection | undefined };
		const { result, rerender } = renderHook(
			({ connection: currentConnection }: Props) => useKiloAgentCatalog(currentConnection),
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
		expect(agentsList).toHaveBeenCalledOnce();
		expect(result.current.data?.agents.map((agent) => agent.name)).toEqual(["code"]);
	});
});
