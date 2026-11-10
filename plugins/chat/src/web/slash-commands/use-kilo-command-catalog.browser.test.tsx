import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "@kilocode/sdk/v2/client";

import type { ServerConnection as KiloGlobalConnection } from "@kilo-desktop/plugin-core/contracts";
import {
	fetchCommandCatalogForConnection,
	useKiloCommandCatalog,
} from "./use-kilo-command-catalog";

/**
 * Answers the Kilo client's requests with `commands` and records which
 * directory each asked about. A stand-in fetch rather than a module mock,
 * which browser-mode runs under load don't always apply.
 */
function serveCommands(commands: unknown) {
	const directories: (string | null)[] = [];
	const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const request = input instanceof Request ? input : new Request(input);
		const url = new URL(request.url);
		directories.push(
			url.searchParams.get("directory") ??
				(request.headers.get("x-kilo-directory") &&
					decodeURIComponent(request.headers.get("x-kilo-directory")!)),
		);
		return new Response(JSON.stringify(commands), {
			headers: { "content-type": "application/json" },
		});
	});
	return { directories, fetchSpy };
}

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
	vi.restoreAllMocks();
});

describe("useKiloCommandCatalog", () => {
	it("waits for a resolved connection and fetches commands once", async () => {
		const served = serveCommands(payload);
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
		expect(served.fetchSpy).not.toHaveBeenCalled();

		rerender({ connection, directory: "/workspace/project" });
		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(served.directories).toEqual(["/workspace/project"]);
		expect(result.current.data?.map((command) => command.name)).toEqual(["init", "compact"]);
	});

	it("uses the connection global directory when no workspace folder is given", async () => {
		const served = serveCommands(payload);
		const { result } = renderHook(() => useKiloCommandCatalog(connection, undefined), {
			wrapper: createWrapper(),
		});

		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(served.directories).toEqual([connection.globalDirectory]);
	});

	it("keeps only autocomplete metadata from lazy MCP commands", async () => {
		serveCommands([
			{
				name: "release-notes",
				description: "Draft release notes",
				source: "mcp",
				template: {},
				hints: ["release"],
			},
		]);

		await expect(
			fetchCommandCatalogForConnection(connection, "/workspace/project"),
		).resolves.toEqual([
			{
				name: "release-notes",
				description: "Draft release notes",
				source: "mcp",
				hints: ["release"],
			},
		]);
	});

	it("throws when asked to fetch commands before a connection is available", async () => {
		const served = serveCommands([]);
		await expect(fetchCommandCatalogForConnection(undefined, "/workspace")).rejects.toThrow(
			"Cannot fetch commands before Kilo is connected",
		);
		expect(served.fetchSpy).not.toHaveBeenCalled();
	});
});
