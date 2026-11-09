import { describe, expect, it } from "vitest";

import { installCommands, mcpRuntime } from "./runtimes.js";

const nothingInstalled = () => false;

describe("mcpRuntime", () => {
	it.each([
		["npx", "Node.js"],
		["node", "Node.js"],
		["npm", "Node.js"],
		["uvx", "uv"],
		["uv", "uv"],
		["docker", "Docker"],
		["python", "Python"],
	])("names the runtime that provides %s", (command, name) => {
		expect(mcpRuntime(command)?.name).toBe(name);
	});

	it("has no runtime for unknown commands", () => {
		expect(mcpRuntime("azmcp")).toBeUndefined();
	});
});

describe("installCommands", () => {
	it("offers Homebrew for Node.js on macOS only when Homebrew is installed", () => {
		expect(installCommands("npx", "darwin", (tool) => tool === "brew")).toEqual([
			"brew install node",
		]);
		expect(installCommands("npx", "darwin", nothingInstalled)).toEqual([]);
	});

	it("offers winget for Node.js on Windows only when winget is installed", () => {
		expect(installCommands("npx", "win32", (tool) => tool === "winget")).toEqual([
			"winget install OpenJS.NodeJS.LTS",
		]);
		expect(installCommands("npx", "win32", nothingInstalled)).toEqual([]);
	});

	it("offers uv's official installer on every platform", () => {
		expect(installCommands("uvx", "darwin", nothingInstalled)).toEqual([
			"curl -LsSf https://astral.sh/uv/install.sh | sh",
		]);
		expect(installCommands("uvx", "linux", nothingInstalled)).toEqual([
			"curl -LsSf https://astral.sh/uv/install.sh | sh",
		]);
		expect(installCommands("uvx", "win32", nothingInstalled)).toEqual([
			'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
		]);
	});

	it.each(["docker", "azmcp"])("leaves %s to its download page", (command) => {
		expect(installCommands(command, "darwin", () => true)).toEqual([]);
	});
});
