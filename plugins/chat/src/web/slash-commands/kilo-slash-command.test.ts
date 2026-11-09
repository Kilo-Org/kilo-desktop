import { describe, expect, it } from "vitest";
import type { Command } from "@kilocode/sdk/v2/client";

import {
	createKiloSlashFormatter,
	extractPromptText,
	groupKiloCommandsBySource,
	mapKiloCommand,
	isLeadingSlashQuery,
	parseSlashDraft,
	slashCommandFromPromptArgs,
} from "./kilo-slash-command";

const initCommand: Command = {
	name: "init",
	description: "Create an AGENTS.md",
	source: "command",
	template: "/init $ARGUMENTS",
	hints: ["initialize"],
};

describe("parseSlashDraft", () => {
	it("parses a command and trailing arguments", () => {
		expect(parseSlashDraft("/init write AGENTS.md")).toEqual({
			command: "init",
			arguments: "write AGENTS.md",
		});
	});

	it("parses a command with no arguments", () => {
		expect(parseSlashDraft("/compact")).toEqual({
			command: "compact",
			arguments: "",
		});
	});

	it("parses a namespaced MCP command", () => {
		expect(parseSlashDraft("/mcp_everything:args-prompt hello")).toEqual({
			command: "mcp_everything:args-prompt",
			arguments: "hello",
		});
	});

	it("returns undefined for ordinary messages", () => {
		expect(parseSlashDraft("hello /init")).toBeUndefined();
		expect(parseSlashDraft("")).toBeUndefined();
	});
});

describe("createKiloSlashFormatter", () => {
	const formatter = createKiloSlashFormatter(
		new Map([
			["init", "command"],
			["compact", "command"],
			["frontend-design", "skill"],
			["browser", "mcp"],
		]),
	);

	it("serializes a command as /id", () => {
		expect(formatter.serialize({ id: "init", type: "command", label: "/init" })).toBe("/init");
	});

	it("chips known slash tokens and leaves arguments as text", () => {
		expect(formatter.parse("/init write AGENTS.md")).toEqual([
			{ kind: "mention", type: "command", label: "init", id: "init" },
			{ kind: "text", text: " write AGENTS.md" },
		]);
		expect(formatter.parse("/compact")).toEqual([
			{ kind: "mention", type: "command", label: "compact", id: "compact" },
		]);
	});

	it("tags chips with the catalog source category", () => {
		expect(formatter.parse("/frontend-design dark theme")).toEqual([
			{ kind: "mention", type: "skill", label: "frontend-design", id: "frontend-design" },
			{ kind: "text", text: " dark theme" },
		]);
		expect(formatter.parse("/browser open docs")).toEqual([
			{ kind: "mention", type: "mcp", label: "browser", id: "browser" },
			{ kind: "text", text: " open docs" },
		]);
	});

	it("chips a namespaced MCP command", () => {
		const mcpFormatter = createKiloSlashFormatter(new Map([["mcp_everything:args-prompt", "mcp"]]));

		expect(mcpFormatter.parse("/mcp_everything:args-prompt hello")).toEqual([
			{
				kind: "mention",
				type: "mcp",
				label: "mcp_everything:args-prompt",
				id: "mcp_everything:args-prompt",
			},
			{ kind: "text", text: " hello" },
		]);
	});

	it("does not chip unknown or incomplete names", () => {
		expect(formatter.parse("/unknown")).toEqual([{ kind: "text", text: "/unknown" }]);
		expect(formatter.parse("/ini")).toEqual([{ kind: "text", text: "/ini" }]);
		expect(formatter.parse("/initialize")).toEqual([{ kind: "text", text: "/initialize" }]);
	});

	it("does not chip a known command after leading text", () => {
		expect(formatter.parse("hello /init")).toEqual([{ kind: "text", text: "hello /init" }]);
		expect(formatter.parse("what is /coss")).toEqual([{ kind: "text", text: "what is /coss" }]);
	});
});

describe("isLeadingSlashQuery", () => {
	it("matches a draft that is only / or /name", () => {
		expect(isLeadingSlashQuery("/")).toBe(true);
		expect(isLeadingSlashQuery("/init")).toBe(true);
		expect(isLeadingSlashQuery("/frontend-design")).toBe(true);
	});

	it("rejects arguments, mid-sentence slashes, and empty text", () => {
		expect(isLeadingSlashQuery("")).toBe(false);
		expect(isLeadingSlashQuery("/init write AGENTS.md")).toBe(false);
		expect(isLeadingSlashQuery("what is /")).toBe(false);
		expect(isLeadingSlashQuery("what is /coss")).toBe(false);
	});
});

describe("mapKiloCommand", () => {
	it("maps a Kilo command onto slash-menu fields", () => {
		expect(mapKiloCommand(initCommand)).toEqual({
			id: "init",
			label: "init",
			description: "Create an AGENTS.md",
			icon: "command",
		});
	});

	it("defaults the icon to command when source is missing", () => {
		const { source: _source, ...withoutSource } = initCommand;
		expect(mapKiloCommand(withoutSource).icon).toBe("command");
	});
});

describe("groupKiloCommandsBySource", () => {
	it("groups commands by source and omits empty categories", () => {
		expect(
			groupKiloCommandsBySource([
				mapKiloCommand(initCommand),
				mapKiloCommand({
					...initCommand,
					name: "frontend-design",
					source: "skill",
					description: "Create UI",
				}),
				mapKiloCommand({
					...initCommand,
					name: "browser",
					source: "mcp",
					description: "Browser tools",
				}),
			]).map((group) => [group.id, group.items.map((item) => item.id)]),
		).toEqual([
			["command", ["init"]],
			["skill", ["frontend-design"]],
			["mcp", ["browser"]],
		]);
	});

	it("stays a single group when every command shares a source", () => {
		expect(
			groupKiloCommandsBySource([mapKiloCommand(initCommand)]).map((group) => group.id),
		).toEqual(["command"]);
	});
});

describe("slashCommandFromPromptArgs", () => {
	it("extracts a known slash command from text parts", () => {
		expect(
			slashCommandFromPromptArgs({ parts: [{ type: "text", text: "/init write AGENTS.md" }] }, [
				"init",
				"compact",
			]),
		).toEqual({ command: "init", arguments: "write AGENTS.md" });
	});

	it("extracts a known namespaced MCP command", () => {
		expect(
			slashCommandFromPromptArgs({ text: "/mcp_everything:args-prompt hello" }, [
				"mcp_everything:args-prompt",
			]),
		).toEqual({ command: "mcp_everything:args-prompt", arguments: "hello" });
	});

	it("ignores unknown names and non-slash text", () => {
		expect(
			slashCommandFromPromptArgs({ parts: [{ type: "text", text: "/unknown" }] }, ["init"]),
		).toBeUndefined();
		expect(
			slashCommandFromPromptArgs({ parts: [{ type: "text", text: "hello" }] }, ["init"]),
		).toBeUndefined();
		expect(
			slashCommandFromPromptArgs({ parts: [{ type: "text", text: "/init" }] }, []),
		).toBeUndefined();
	});

	it("reads a bare text field", () => {
		expect(extractPromptText({ text: "/compact" })).toBe("/compact");
	});
});
