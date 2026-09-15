import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../runtime/create-kilo-runtime-client.js";
import {
	fetchCommandCatalogForConnection,
	useKiloCommandCatalog,
} from "./use-kilo-command-catalog.js";

const commandList = vi.hoisted(() => vi.fn());

vi.mock("../runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		command: { list: commandList },
	})),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo-user",
	password: "kilo-password",
	version: "7.4.20",
	globalDirectory: "/kilo/runtime",
};

const payload: Command[] = [
	{
		name: "init",
		description: "Create an AGENTS.md",
		source: "command",
		template: "/init $ARGUMENTS",
		hints: [],
	},
	{
		name: "compact",
		description: "Compact the conversation",
		source: "command",
		template: "/compact",
		hints: [],
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

describe("useKiloCommandCatalog", () => {
	it("waits for a resolved connection and fetches commands once", async () => {
		commandList.mockResolvedValue({ data: payload });
		type Props = { connection: KiloGlobalConnection | undefined; directory?: string };
		const { result, rerender } = renderHook(
			({ connection: currentConnection, directory }: Props) =>
				useKiloCommandCatalog(currentConnection, directory),
			{
				initialProps: { connection: undefined } as Props,
				wrapper: createWrapper(),
			},
		);

		expect(result.current.fetchStatus).toBe("idle");
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();

		rerender({ connection, directory: "/workspace/project" });
		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(createKiloDirectoryClient).toHaveBeenCalledExactlyOnceWith(
			connection,
			"/workspace/project",
		);
		expect(commandList).toHaveBeenCalledWith(
			{ directory: "/workspace/project" },
			{ throwOnError: true },
		);
		expect(result.current.data?.map((command) => command.name)).toEqual(["init", "compact"]);
	});

	it("uses the connection global directory when no workspace folder is given", async () => {
		commandList.mockResolvedValue({ data: payload });
		const { result } = renderHook(() => useKiloCommandCatalog(connection, undefined), {
			wrapper: createWrapper(),
		});

		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(createKiloDirectoryClient).toHaveBeenCalledExactlyOnceWith(
			connection,
			connection.globalDirectory,
		);
	});

	it("throws when asked to fetch commands before a connection is available", async () => {
		await expect(fetchCommandCatalogForConnection(undefined, "/workspace")).rejects.toThrow(
			"Cannot fetch commands before Kilo is connected",
		);
		expect(createKiloDirectoryClient).not.toHaveBeenCalled();
	});
});
