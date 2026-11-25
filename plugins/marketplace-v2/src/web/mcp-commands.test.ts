import { describe, expect, it } from "vitest";

import {
	fixMissingCommandPrompt,
	mcpLaunchCommand,
	missingCommand,
	missingCommandMessage,
} from "./mcp-commands";

describe("mcpLaunchCommand", () => {
	it("reads the command a local server config launches", () => {
		expect(
			mcpLaunchCommand(
				JSON.stringify(
					{ type: "local", command: ["npx", "-y", "@playwright/mcp@0.0.38"] },
					null,
					2,
				),
			),
		).toBe("npx");
	});

	it.each([
		["remote servers", '{"type": "remote", "url": "https://mcp.example.com"}'],
		["unparseable content", "not json"],
		["templated commands", '{"type": "local", "command": ["{{BINARY}}"]}'],
		["absolute paths", '{"type": "local", "command": ["/opt/tools/server"]}'],
		["Windows paths", '{"type": "local", "command": ["C:\\\\tools\\\\server.exe"]}'],
	])("has no command to check for %s", (_label, content) => {
		expect(mcpLaunchCommand(content)).toBeUndefined();
	});
});

describe("missingCommand", () => {
	it.each([
		['Executable not found in $PATH: "npx"', "npx"],
		["spawn uvx ENOENT", "uvx"],
		["spawn docker.exe ENOENT", "docker"],
	])("recognises %s", (error, command) => {
		expect(missingCommand(error)).toBe(command);
	});

	it("ignores other failures", () => {
		expect(missingCommand("Operation timed out after 30000ms")).toBeUndefined();
	});
});

describe("missingCommandMessage", () => {
	it.each([
		["npx", "npx was not found. Install Node.js, then restart Kilo Desktop."],
		["uvx", "uvx was not found. Install uv, then restart Kilo Desktop."],
		["docker", "docker was not found. Install Docker, then restart Kilo Desktop."],
		["azmcp", "azmcp was not found. Install it, then restart Kilo Desktop."],
	])("tells the user what to install for %s", (command, message) => {
		expect(missingCommandMessage(command)).toBe(message);
	});
});

describe("fixMissingCommandPrompt", () => {
	it("asks for a reviewed install of the runtime and a restart", () => {
		expect(fixMissingCommandPrompt("npx")).toBe(
			[
				"Kilo Desktop can't find the `npx` command, so MCP servers that need Node.js can't start.",
				"",
				"Help me install Node.js on this computer:",
				"1. Check my operating system and whether Node.js or a package manager (such as Homebrew or winget) is already installed.",
				"2. Recommend the official way to install it here, and explain each command before running it.",
				"3. Confirm `npx` works in a new terminal, then remind me to restart Kilo Desktop so it picks up the new PATH.",
			].join("\n"),
		);
	});

	it("asks which program provides an unknown command", () => {
		expect(fixMissingCommandPrompt("azmcp")).toContain(
			"Help me find and install the program that provides `azmcp` on this computer:",
		);
	});
});
