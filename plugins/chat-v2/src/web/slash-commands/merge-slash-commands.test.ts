import { afterEach, describe, expect, it, vi } from "vitest";

import {
	groupSlashCommands,
	mergeSlashCommands,
	resolveTypedSlash,
	searchSlashCommands,
	type ClientSlashEntry,
} from "./merge-slash-commands";
import type { KiloCommandCatalogEntry } from "./use-kilo-command-catalog";

const compact: ClientSlashEntry = {
	key: "kilo.chat/compact",
	name: "compact",
	description: "Summarize the chat so far to free up context",
	aliases: ["smol", "condense"],
};

const server = (
	name: string,
	source: KiloCommandCatalogEntry["source"] = "command",
	description?: string,
): KiloCommandCatalogEntry => ({
	name,
	source,
	hints: [],
	...(description ? { description } : {}),
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("mergeSlashCommands", () => {
	it("lists client commands as actions first, then server commands, skills and MCP prompts", () => {
		const merged = mergeSlashCommands(
			[compact],
			[server("tidy", "skill"), server("browser:open", "mcp"), server("review")],
		);
		expect(merged.map((command) => [command.id, command.category])).toEqual([
			["compact", "action"],
			["review", "command"],
			["tidy", "skill"],
			["browser:open", "mcp"],
		]);
		expect(merged[0]).toMatchObject({
			clientKey: "kilo.chat/compact",
			aliases: ["smol", "condense"],
		});
		expect(merged[1]!.clientKey).toBeUndefined();
	});

	it("hides a server command with a client command's name", () => {
		const merged = mergeSlashCommands([compact], [server("compact"), server("review")]);
		expect(merged.map((command) => [command.id, command.category])).toEqual([
			["compact", "action"],
			["review", "command"],
		]);
	});

	it("never hides a server command with a client command's alias", () => {
		const merged = mergeSlashCommands([compact], [server("smol")]);
		expect(merged.map((command) => [command.id, command.category])).toEqual([
			["compact", "action"],
			["smol", "command"],
		]);
	});

	it("names a skill sharing a server command's name name:skill", () => {
		const merged = mergeSlashCommands([], [server("review"), server("review", "skill")]);
		expect(merged.map((command) => [command.id, command.category])).toEqual([
			["review", "command"],
			["review:skill", "skill"],
		]);
	});

	it("keeps the first of two client commands with one name and warns about the other", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const merged = mergeSlashCommands(
			[compact, { key: "acme.tools/compact", name: "compact", aliases: [] }],
			[],
		);
		expect(merged.map((command) => command.clientKey)).toEqual(["kilo.chat/compact"]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("acme.tools/compact"));
	});
});

describe("groupSlashCommands", () => {
	it("groups the menu by category, leaving out empty ones", () => {
		const groups = groupSlashCommands(
			mergeSlashCommands([compact], [server("review"), server("browser:open", "mcp")]),
		);
		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			["Actions", ["compact"]],
			["Commands", ["review"]],
			["MCP", ["browser:open"]],
		]);
	});
});

describe("searchSlashCommands", () => {
	const commands = mergeSlashCommands(
		[compact],
		[
			server("review", "command", "Review the changes before you compact them"),
			server("compactor", "command"),
			server("init", "command", "Create an AGENTS.md"),
		],
	);
	const ids = (query: string) => searchSlashCommands(query, commands).map((command) => command.id);

	it("lists everything, in menu order, for an empty query", () => {
		expect(ids("")).toEqual(["compact", "review", "compactor", "init"]);
	});

	it("ranks an exact name, then a name prefix, then a description match", () => {
		expect(ids("compact")).toEqual(["compact", "compactor", "review"]);
	});

	it("matches aliases, ranked above description matches", () => {
		expect(ids("smol")).toEqual(["compact"]);
		expect(ids("cond")).toEqual(["compact"]);
	});

	it("ignores case and leaves out what doesn't match", () => {
		expect(ids("INIT")).toEqual(["init"]);
		expect(ids("nothing")).toEqual([]);
	});
});

describe("resolveTypedSlash", () => {
	it("finds a client command by name or alias", () => {
		const commands = mergeSlashCommands([compact], [server("review")]);
		expect(resolveTypedSlash("compact", commands)).toEqual({
			kind: "client",
			key: "kilo.chat/compact",
		});
		expect(resolveTypedSlash("smol", commands)).toEqual({
			kind: "client",
			key: "kilo.chat/compact",
		});
	});

	it("finds a server command by name, ahead of a client command's alias", () => {
		const commands = mergeSlashCommands([compact], [server("review"), server("smol")]);
		expect(resolveTypedSlash("review", commands)).toEqual({ kind: "server", name: "review" });
		expect(resolveTypedSlash("smol", commands)).toEqual({ kind: "server", name: "smol" });
	});

	it("knows nothing of other words", () => {
		expect(resolveTypedSlash("unknown", mergeSlashCommands([compact], []))).toBeUndefined();
	});
});
