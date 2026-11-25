import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeKiloServer } from "../../test/fake-kilo-server";
import {
	fetchCommandCatalogForConnection,
	useKiloCommandCatalog,
} from "./use-kilo-command-catalog";

/** A Kilo v2 server listing `commands`, answering the window's fetch. */
function serveCommands(commands: Record<string, unknown>[]) {
	const server = new FakeKiloServer();
	server.commands = commands;
	server.install();
	const commandReads = () =>
		server.requestsTo("GET", "/api/command").map((request) => request.directory);
	return { server, commandReads };
}

const COMMANDS = [
	{ name: "init", description: "Create an AGENTS.md", template: "/init $ARGUMENTS" },
	{ name: "compact", description: "Compact the conversation", template: "/compact" },
];

function createWrapper() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("useKiloCommandCatalog", () => {
	it("waits for a resolved connection and fetches commands once", async () => {
		const { server, commandReads } = serveCommands(COMMANDS);
		type Props = { connection: FakeKiloServer["connection"] | undefined; directory?: string };
		const { result, rerender } = renderHook(
			({ connection, directory }: Props) => useKiloCommandCatalog(connection, directory),
			{ initialProps: { connection: undefined } as Props, wrapper: createWrapper() },
		);

		expect(result.current.fetchStatus).toBe("idle");
		expect(server.requests).toEqual([]);

		rerender({ connection: server.connection, directory: "/workspace/project" });
		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(commandReads()).toEqual(["/workspace/project"]);
		expect(result.current.data?.map((command) => command.name)).toEqual(["init", "compact"]);
	});

	it("uses the connection global directory when no workspace folder is given", async () => {
		const { server, commandReads } = serveCommands(COMMANDS);
		const { result } = renderHook(() => useKiloCommandCatalog(server.connection, undefined), {
			wrapper: createWrapper(),
		});

		await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(commandReads()).toEqual([server.connection.globalDirectory]);
	});

	it("keeps only autocomplete metadata, not the command's template", async () => {
		const { server } = serveCommands([
			{ name: "release-notes", description: "Draft release notes", template: "Notes for $1" },
		]);

		await expect(
			fetchCommandCatalogForConnection(server.connection, "/workspace/project"),
		).resolves.toEqual([
			{
				name: "release-notes",
				description: "Draft release notes",
				source: "command",
				hints: ["$1"],
			},
		]);
	});

	it("lists the folder's skills after its commands", async () => {
		const { server } = serveCommands([{ name: "init", template: "" }]);
		server.skills = [
			{ id: "tidy", name: "tidy", description: "Tidy imports", path: "/s/tidy", content: "" },
		];

		await expect(
			fetchCommandCatalogForConnection(server.connection, "/workspace/project"),
		).resolves.toEqual([
			{ name: "init", source: "command", hints: [] },
			{ name: "tidy", description: "Tidy imports", source: "skill", hints: [], skillId: "tidy" },
		]);
		expect(server.requestsTo("GET", "/api/skill")[0]?.directory).toBe("/workspace/project");
	});

	it("throws when asked to fetch commands before a connection is available", async () => {
		const { server } = serveCommands([]);
		await expect(fetchCommandCatalogForConnection(undefined, "/workspace")).rejects.toThrow(
			"Cannot fetch commands before Kilo is connected",
		);
		expect(server.requests).toEqual([]);
	});
});
