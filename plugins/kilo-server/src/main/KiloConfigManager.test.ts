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
		configPath = path.join(tempDir, "kilo", "kilo.jsonc");
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
						url: "https://anaconda.cloud/api/mcp",
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
						url: "https://anaconda.cloud/api/mcp",
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
					url: "https://anaconda.cloud/api/mcp",
					headers: { Authorization: "Bearer {env:ANACONDA_API_KEY}" },
				},
				true,
			);

			expect(existsSync(configPath)).toBe(true);
			const content = JSON.parse(await readFile(configPath, "utf-8"));
			expect(content.mcp["anaconda-remote"]).toEqual({
				type: "remote",
				url: "https://anaconda.cloud/api/mcp",
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
				{ type: "remote", url: "https://anaconda.cloud/api/mcp" },
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

	describe("configDir", () => {
		it("exposes the config directory", () => {
			expect(configManager.configDir).toBe(path.join(tempDir, "kilo"));
		});
	});

	describe("file resolution (kilo.jsonc vs kilo.json)", () => {
		const jsoncPath = () => path.join(tempDir, "kilo", "kilo.jsonc");
		const jsonPath = () => path.join(tempDir, "kilo", "kilo.json");

		it("prefers kilo.jsonc when both files exist", async () => {
			await writeConfigFile(jsoncPath(), {
				mcp: { "from-jsonc": { type: "remote", url: "https://jsonc.example.com" } },
			});
			await writeConfigFile(jsonPath(), {
				mcp: { "from-json": { type: "remote", url: "https://json.example.com" } },
			});

			const entries = await configManager.list();
			expect(entries.map((e) => e.id)).toEqual(["from-jsonc"]);
		});

		it("falls back to kilo.json when only kilo.json exists", async () => {
			await writeConfigFile(jsonPath(), {
				mcp: { legacy: { type: "remote", url: "https://legacy.example.com" } },
			});

			const entries = await configManager.list();
			expect(entries.map((e) => e.id)).toEqual(["legacy"]);
		});

		it("writes new entries to kilo.jsonc (Kilo's default) when neither file exists", async () => {
			await configManager.save(
				"anaconda-remote",
				{ type: "remote", url: "https://anaconda.cloud/api/mcp" },
				true,
			);

			expect(existsSync(jsoncPath())).toBe(true);
			expect(existsSync(jsonPath())).toBe(false);
		});

		it("writes updates to whichever file was read (kilo.json when only .json exists)", async () => {
			await writeConfigFile(jsonPath(), {
				mcp: { existing: { type: "remote", url: "https://a.example.com" } },
			});

			await configManager.save(
				"anaconda-remote",
				{ type: "remote", url: "https://anaconda.cloud/api/mcp" },
				true,
			);

			// Update went to kilo.json, not a new kilo.jsonc.
			expect(existsSync(jsoncPath())).toBe(false);
			expect(existsSync(jsonPath())).toBe(true);
			const content = JSON.parse(await readFile(jsonPath(), "utf-8"));
			expect(Object.keys(content.mcp).sort()).toEqual(["anaconda-remote", "existing"]);
		});

		it("moves a stray kilo.json aside when kilo.jsonc also exists and every entry is ours", async () => {
			// Simulate the pre-fix state: our old code wrote a bare kilo.json
			// containing only managed entries alongside the user's kilo.jsonc.
			await writeConfigFile(jsoncPath(), {
				mcp: { sesame: { type: "stdio", command: "sesame" } },
			});
			await writeConfigFile(jsonPath(), {
				$schema: "https://app.kilo.ai/config.json",
				mcp: {
					"anaconda-remote": {
						type: "remote",
						url: "https://x",
						enabled: true,
						_managedBy: "anaconda-desktop",
					},
				},
			});

			// Any read triggers cleanup.
			const entries = await configManager.list();

			expect(existsSync(jsonPath())).toBe(false);
			expect(existsSync(jsoncPath())).toBe(true);
			// User's entries in kilo.jsonc are what's visible now.
			expect(entries.map((e) => e.id)).toEqual(["sesame"]);
			// The stray file is preserved as a backup for post-mortem.
			const dirEntries = await (await import("node:fs/promises")).readdir(path.dirname(jsonPath()));
			expect(dirEntries.some((n) => n.startsWith("kilo.json.stray-"))).toBe(true);
		});

		it("does NOT touch kilo.json when it has any user-authored content", async () => {
			await writeConfigFile(jsoncPath(), {
				mcp: { sesame: { type: "stdio", command: "sesame" } },
			});
			// kilo.json has a user's own MCP (no _managedBy marker).
			await writeConfigFile(jsonPath(), {
				mcp: {
					"user-mcp": { type: "remote", url: "https://user.example.com" },
				},
			});

			await configManager.list();

			expect(existsSync(jsonPath())).toBe(true);
			expect(existsSync(jsoncPath())).toBe(true);
		});

		it("does NOT touch kilo.json when it has top-level keys other than mcp/$schema", async () => {
			await writeConfigFile(jsoncPath(), { mcp: {} });
			// kilo.json has a "provider" key — user config, not ours.
			await writeConfigFile(jsonPath(), {
				provider: { foo: { npm: "example" } },
				mcp: {
					"anaconda-remote": {
						type: "remote",
						url: "https://x",
						_managedBy: "anaconda-desktop",
					},
				},
			});

			await configManager.list();

			expect(existsSync(jsonPath())).toBe(true);
		});
	});

	describe("JSONC comment tolerance", () => {
		it("reads a kilo.jsonc with // line comments", async () => {
			const jsoncPath = path.join(tempDir, "kilo", "kilo.jsonc");
			await mkdir(path.dirname(jsoncPath), { recursive: true });
			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				jsoncPath,
				`{
  // The Anaconda Remote MCP is auto-managed
  "mcp": {
    "sesame": { "type": "stdio", "command": "sesame" } // local dev tool
  }
}`,
				"utf-8",
			);

			const entries = await configManager.list();
			expect(entries.map((e) => e.id)).toEqual(["sesame"]);
		});

		it("reads a kilo.jsonc with /* block */ comments", async () => {
			const jsoncPath = path.join(tempDir, "kilo", "kilo.jsonc");
			await mkdir(path.dirname(jsoncPath), { recursive: true });
			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				jsoncPath,
				`{
  /* Global MCP servers.
     Managed by the user; do not edit while Kilo is running. */
  "mcp": { "electron-driver": { "type": "stdio", "command": "npx electron-driver" } }
}`,
				"utf-8",
			);

			const entries = await configManager.list();
			expect(entries.map((e) => e.id)).toEqual(["electron-driver"]);
		});

		it("does not treat // inside strings as a comment", async () => {
			const jsoncPath = path.join(tempDir, "kilo", "kilo.jsonc");
			await mkdir(path.dirname(jsoncPath), { recursive: true });
			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				jsoncPath,
				`{ "mcp": { "s": { "type": "remote", "url": "https://a.example.com//path" } } }`,
				"utf-8",
			);

			const entries = await configManager.list();
			expect(entries[0]).toBeDefined();
			expect((entries[0]!.transport as { url: string }).url).toBe("https://a.example.com//path");
		});
	});

	// Regression: PR #116 review — CRITICAL (proto pollution) + WARNING
	// (unhandled TypeError on null entry). The RPC schema rejects reserved
	// ids at the boundary; this class is also called from other main-side
	// plugins via the kiloService capability, so it validates too.
	describe("hostile input", () => {
		it("refuses to write an entry under __proto__ (prototype pollution guard)", async () => {
			await expect(
				configManager.save("__proto__", { type: "remote", url: "https://evil.example.com" }, true),
			).rejects.toThrow(/reserved JavaScript property name/i);
			// And the prototype chain must be untouched.
			expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
		});

		it("refuses constructor and prototype ids too", async () => {
			await expect(
				configManager.save("constructor", { type: "remote", url: "https://x.example" }, true),
			).rejects.toThrow(/reserved/i);
			await expect(
				configManager.save("prototype", { type: "remote", url: "https://x.example" }, true),
			).rejects.toThrow(/reserved/i);
		});

		it("silently drops null / non-object mcp entries during list() instead of throwing", async () => {
			// A user hand-edits kilo.jsonc and ends up with `"foo": null` or
			// `"foo": "some string"` under mcp. Before the fix this crashed
			// with a TypeError inside #entryToTransport.
			await writeConfigFile(configPath, {
				mcp: {
					real: { type: "remote", url: "https://ok.example.com", enabled: true },
					bogusNull: null,
					bogusString: "not-an-object",
					bogusArray: [1, 2, 3],
				},
			});
			const entries = await configManager.list();
			expect(entries.map((entry) => entry.id)).toEqual(["real"]);
		});

		it("silently drops reserved-name keys during list() (defense in depth)", async () => {
			// If a corrupt file somehow contains a reserved key, we do NOT
			// materialize it as an MCP entry the UI would then round-trip.
			// __proto__ under mcp does NOT pollute Object.prototype for
			// entries created via JSON.parse (it becomes a normal own
			// property because JSON.parse ignores __proto__), but the id is
			// still reserved on our end.
			await writeConfigFile(configPath, {
				mcp: {
					real: { type: "remote", url: "https://ok.example.com", enabled: true },
					__proto__: { type: "remote", url: "https://evil.example.com" },
				},
			});
			const entries = await configManager.list();
			expect(entries.map((entry) => entry.id)).toEqual(["real"]);
		});
	});
});

async function writeConfigFile(filePath: string, content: Record<string, unknown>): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	const { writeFile } = await import("node:fs/promises");
	await writeFile(filePath, JSON.stringify(content, null, "\t"), "utf-8");
}
