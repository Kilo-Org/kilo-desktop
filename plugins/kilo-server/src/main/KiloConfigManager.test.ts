import { readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KiloConfigManager } from "./KiloConfigManager.js";

describe("KiloConfigManager", () => {
	let tempDir: string;
	let configManager: KiloConfigManager;
	let configPath: string;

	beforeEach(async () => {
		tempDir = path.join(
			os.tmpdir(),
			`kilo-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tempDir, { recursive: true });
		configManager = new KiloConfigManager({ configHome: tempDir });
		configPath = path.join(tempDir, "kilo", "kilo.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("list", () => {
		it("returns an empty array when no config file exists", async () => {
			const result = await configManager.list();
			expect(result).toEqual([]);
		});

		it("returns an empty array when config file has no mcp key", async () => {
			await writeConfigFile(configPath, { someOtherKey: true });
			const result = await configManager.list();
			expect(result).toEqual([]);
		});

		it("returns remote MCP entries", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"anaconda-remote": {
						type: "remote",
						url: "https://mcp.anaconda.com/mcp",
						headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
						enabled: true,
					},
				},
			});
			const result = await configManager.list();
			expect(result).toEqual([
				{
					id: "anaconda-remote",
					scope: "global",
					transport: {
						type: "remote",
						url: "https://mcp.anaconda.com/mcp",
						headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
					},
					enabled: true,
				},
			]);
		});

		it("returns stdio MCP entries", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"local-tools": {
						type: "stdio",
						command: "node",
						args: ["server.js"],
						env: { PORT: "3000" },
						enabled: true,
					},
				},
			});
			const result = await configManager.list();
			expect(result).toEqual([
				{
					id: "local-tools",
					scope: "global",
					transport: {
						type: "stdio",
						command: "node",
						args: ["server.js"],
						env: { PORT: "3000" },
					},
					enabled: true,
				},
			]);
		});

		it("treats missing enabled field as true", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"my-server": {
						type: "remote",
						url: "https://example.com/mcp",
					},
				},
			});
			const result = await configManager.list();
			expect(result[0]!.enabled).toBe(true);
		});

		it("treats enabled: false correctly", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"my-server": {
						type: "remote",
						url: "https://example.com/mcp",
						enabled: false,
					},
				},
			});
			const result = await configManager.list();
			expect(result[0]!.enabled).toBe(false);
		});

		it("skips entries with unknown type", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					valid: { type: "remote", url: "https://example.com" },
					invalid: { type: "unknown" },
				},
			});
			const result = await configManager.list();
			expect(result).toHaveLength(1);
			expect(result[0]!.id).toBe("valid");
		});

		it("skips entries with missing required fields", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"no-url": { type: "remote" },
					"no-command": { type: "stdio" },
					valid: { type: "remote", url: "https://example.com" },
				},
			});
			const result = await configManager.list();
			expect(result).toHaveLength(1);
			expect(result[0]!.id).toBe("valid");
		});

		it("refuses to read malformed JSON and moves it to a backup file", async () => {
			await mkdir(path.dirname(configPath), { recursive: true });
			const { writeFile } = await import("node:fs/promises");
			await writeFile(configPath, "this is not json{{{", "utf-8");
			await expect(configManager.list()).rejects.toThrow(/not valid JSON/);
			// The corrupt file should be moved aside so subsequent reads start fresh.
			expect(existsSync(configPath)).toBe(false);
		});
	});

	describe("save", () => {
		it("creates the config file and directory if they do not exist", async () => {
			await configManager.save(
				"anaconda-remote",
				{
					type: "remote",
					url: "https://mcp.anaconda.com/mcp",
					headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
				},
				true,
			);

			expect(existsSync(configPath)).toBe(true);
			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["anaconda-remote"]).toEqual({
				type: "remote",
				url: "https://mcp.anaconda.com/mcp",
				headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
				enabled: true,
			});
		});

		it("preserves unrelated keys in the config file", async () => {
			await writeConfigFile(configPath, {
				someOtherSetting: "preserve-me",
				mcp: {
					"existing-server": { type: "remote", url: "https://existing.com" },
				},
			});

			await configManager.save(
				"new-server",
				{
					type: "remote",
					url: "https://new.com",
				},
				true,
			);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.someOtherSetting).toBe("preserve-me");
			expect(content.mcp["existing-server"]).toBeDefined();
			expect(content.mcp["new-server"]).toBeDefined();
		});

		it("overwrites an existing entry with the same id", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"my-server": { type: "remote", url: "https://old.com", enabled: true },
				},
			});

			await configManager.save(
				"my-server",
				{
					type: "remote",
					url: "https://new.com",
					headers: { "X-Custom": "value" },
				},
				false,
			);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["my-server"]).toEqual({
				type: "remote",
				url: "https://new.com",
				headers: { "X-Custom": "value" },
				enabled: false,
			});
		});

		it("saves a stdio transport correctly", async () => {
			await configManager.save(
				"local-tools",
				{
					type: "stdio",
					command: "npx",
					args: ["-y", "my-mcp-server"],
					env: { DEBUG: "true" },
				},
				true,
			);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["local-tools"]).toEqual({
				type: "stdio",
				command: "npx",
				args: ["-y", "my-mcp-server"],
				env: { DEBUG: "true" },
				enabled: true,
			});
		});

		it("omits empty headers from remote transport", async () => {
			await configManager.save(
				"minimal",
				{
					type: "remote",
					url: "https://example.com",
				},
				true,
			);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["minimal"]).toEqual({
				type: "remote",
				url: "https://example.com",
				enabled: true,
			});
			expect("headers" in content.mcp["minimal"]).toBe(false);
		});

		it("omits empty args and env from stdio transport", async () => {
			await configManager.save(
				"simple-stdio",
				{
					type: "stdio",
					command: "my-server",
				},
				true,
			);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["simple-stdio"]).toEqual({
				type: "stdio",
				command: "my-server",
				enabled: true,
			});
			expect("args" in content.mcp["simple-stdio"]).toBe(false);
			expect("env" in content.mcp["simple-stdio"]).toBe(false);
		});

		it("writes a _managedBy owner marker when provided", async () => {
			await configManager.save(
				"anaconda-remote",
				{ type: "remote", url: "https://mcp.anaconda.com/mcp" },
				true,
				"anaconda-desktop",
			);
			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["anaconda-remote"]._managedBy).toBe("anaconda-desktop");
		});

		it("omits _managedBy when no owner is provided", async () => {
			await configManager.save(
				"user-added",
				{ type: "remote", url: "https://user.example.com" },
				true,
			);
			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect("_managedBy" in content.mcp["user-added"]).toBe(false);
		});
	});

	describe("remove", () => {
		it("removes the specified entry", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"to-remove": { type: "remote", url: "https://remove.me" },
					"to-keep": { type: "remote", url: "https://keep.me" },
				},
			});

			await configManager.remove("to-remove");

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["to-remove"]).toBeUndefined();
			expect(content.mcp["to-keep"]).toBeDefined();
		});

		it("is a no-op when the entry does not exist", async () => {
			await writeConfigFile(configPath, {
				mcp: { existing: { type: "remote", url: "https://example.com" } },
			});

			await configManager.remove("non-existent");

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["existing"]).toBeDefined();
		});

		it("is a no-op when no config file exists", async () => {
			// Should not throw
			await configManager.remove("anything");
		});
	});

	describe("setEnabled", () => {
		it("sets enabled to false on an existing entry", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"my-server": { type: "remote", url: "https://example.com", enabled: true },
				},
			});

			await configManager.setEnabled("my-server", false);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["my-server"].enabled).toBe(false);
		});

		it("sets enabled to true on an existing entry", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"my-server": { type: "remote", url: "https://example.com", enabled: false },
				},
			});

			await configManager.setEnabled("my-server", true);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["my-server"].enabled).toBe(true);
		});

		it("is a no-op when the entry does not exist", async () => {
			await writeConfigFile(configPath, { mcp: {}, customKey: "preserved" });
			await expect(configManager.setEnabled("missing", true)).resolves.toBeUndefined();
			// The config file should not have been rewritten (customKey preserved as-is).
			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.customKey).toBe("preserved");
		});

		it("is a no-op when no config file exists", async () => {
			await expect(configManager.setEnabled("missing", true)).resolves.toBeUndefined();
			expect(existsSync(configPath)).toBe(false);
		});

		it("preserves all other fields of the entry", async () => {
			await writeConfigFile(configPath, {
				mcp: {
					"my-server": {
						type: "remote",
						url: "https://example.com",
						headers: { Authorization: "Bearer token" },
						enabled: true,
					},
				},
			});

			await configManager.setEnabled("my-server", false);

			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["my-server"]).toEqual({
				type: "remote",
				url: "https://example.com",
				headers: { Authorization: "Bearer token" },
				enabled: false,
			});
		});
	});

	describe("configPath", () => {
		it("exposes the resolved config path", () => {
			expect(configManager.configPath).toBe(path.join(tempDir, "kilo", "kilo.json"));
		});
	});
});

async function writeConfigFile(filePath: string, content: Record<string, unknown>): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	const { writeFile } = await import("node:fs/promises");
	await writeFile(filePath, JSON.stringify(content, null, "\t"), "utf-8");
}
