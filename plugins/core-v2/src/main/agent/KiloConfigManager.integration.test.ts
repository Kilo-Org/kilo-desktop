import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	KILO_V2_CONFIG_FILENAME,
	OWNERSHIP_SIDECAR_FILENAME,
	KiloConfigManager,
} from "./KiloConfigManager.js";

const SOURCE_ONE = "feature-one";
const SOURCE_TWO = "feature-two";
const LEGACY_OWNERSHIP_SIDECAR_FILENAME = ".anaconda-desktop-ownership.json";

describe("KiloConfigManager", () => {
	let tempDirectory: string;
	let configDirectory: string;

	beforeEach(async () => {
		tempDirectory = await mkdtemp(path.join(tmpdir(), "kilo-mcp-config-"));
		configDirectory = path.join(tempDirectory, "config", "kilo");
		await mkdir(configDirectory, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDirectory, { recursive: true, force: true });
	});

	async function readConfig(): Promise<Record<string, Record<string, unknown> | undefined>> {
		return parse(
			await readFile(path.join(configDirectory, KILO_V2_CONFIG_FILENAME), "utf8"),
		) as Record<string, Record<string, unknown> | undefined>;
	}

	async function mcpServers(): Promise<Record<string, unknown> | undefined> {
		return (await readConfig()).mcp?.servers as Record<string, unknown> | undefined;
	}

	it("serializes concurrent writers so both Desktop-owned entries survive", async () => {
		const config = new KiloConfigManager(configDirectory);

		await Promise.all([
			config.setMcpEntry(SOURCE_ONE, "one", {
				type: "remote",
				url: "https://one.test/mcp",
			}),
			config.setMcpEntry(SOURCE_TWO, "two", {
				type: "remote",
				url: "https://two.test/mcp",
			}),
		]);

		expect(await mcpServers()).toEqual({
			one: { type: "remote", url: "https://one.test/mcp" },
			two: { type: "remote", url: "https://two.test/mcp" },
		});
		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { ownedEntryKeys: string[]; owners: Record<string, string> };
		expect(sidecar.ownedEntryKeys).toEqual(["mcp:one", "mcp:two"]);
		expect(sidecar.owners).toEqual({ "mcp:one": SOURCE_ONE, "mcp:two": SOURCE_TWO });
	});

	it("lists Desktop-owned MCP entries with their contributing source", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setMcpEntry(SOURCE_ONE, "one", {
			type: "remote",
			url: "https://one.test/mcp",
		});
		await config.setProviderEntry(SOURCE_TWO, "provider", {
			name: "Provider",
		});

		await expect(config.listMcpEntries()).resolves.toEqual([{ id: "one", sourceId: SOURCE_ONE }]);
	});

	it("lists only MCP entries owned by the requested source", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setMcpEntry(SOURCE_ONE, "one", { type: "remote" });
		await config.setMcpEntry(SOURCE_ONE, "two", { type: "remote" });
		await config.setMcpEntry(SOURCE_TWO, "other", { type: "remote" });
		await config.setProviderEntry(SOURCE_ONE, "provider", { name: "Provider" });

		await expect(config.listOwnedEntryIds("mcp", SOURCE_ONE)).resolves.toEqual(["one", "two"]);
		await expect(config.listOwnedEntryIds("mcp", SOURCE_TWO)).resolves.toEqual(["other"]);
	});

	it("owns agent and command entries per section and source, beside the user's", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({ agents: { mine: { system: "user agent" } } })}\n`,
		);
		const config = new KiloConfigManager(configDirectory);
		const reviewer = { description: "Reviews", prompt: "Review it.", mode: "subagent" };

		await expect(config.setEntry("agent", SOURCE_ONE, "reviewer", reviewer)).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		await config.setEntry("command", SOURCE_ONE, "reviewer", { template: "Review $ARGUMENTS" });
		await config.setEntry("command", SOURCE_TWO, "other", { template: "Other" });
		await expect(
			config.setEntry("agent", SOURCE_ONE, "mine", { prompt: "taken over" }),
		).resolves.toEqual({ kind: "skipped", reason: "entry-not-owned" });

		expect(await readConfig()).toEqual({
			agents: {
				mine: { system: "user agent" },
				reviewer: { description: "Reviews", system: "Review it.", mode: "subagent" },
			},
			commands: {
				reviewer: { template: "Review $ARGUMENTS" },
				other: { template: "Other" },
			},
		});
		await expect(config.listOwnedEntryIds("agent", SOURCE_ONE)).resolves.toEqual(["reviewer"]);
		await expect(config.listOwnedEntryIds("command", SOURCE_ONE)).resolves.toEqual(["reviewer"]);
		await expect(config.listOwnedEntryIds("mcp", SOURCE_ONE)).resolves.toEqual([]);

		await expect(config.removeEntry("agent", SOURCE_ONE, "reviewer")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		await expect(config.removeEntry("command", SOURCE_ONE, "other")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		expect((await readConfig()).agents).toEqual({ mine: { system: "user agent" } });
	});

	it("preserves user comments and refuses to claim an entry Desktop does not own", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		await writeFile(
			filePath,
			`{
  // user-owned entry
  "mcp": { "servers": { "shared": { "type": "remote", "url": "https://user.test" } } }
}
`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.setMcpEntry(SOURCE_ONE, "shared", {
				type: "remote",
				url: "https://desktop.test",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "entry-not-owned" });
		expect(await readFile(filePath, "utf8")).toContain("// user-owned entry");
		expect((await mcpServers())?.shared).toEqual({
			type: "remote",
			url: "https://user.test",
		});
	});

	it("appends a Desktop-owned permission rule after the user's rules", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		await writeFile(
			filePath,
			`{\n  // user rules\n  "permissions": [{ "action": "shell", "resource": "*", "effect": "allow" }]\n}\n`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(config.setPermissionEntry(SOURCE_ONE, "suggest", "deny")).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		await expect(config.setPermissionEntry(SOURCE_ONE, "suggest", "deny")).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});
		expect(await readFile(filePath, "utf8")).toContain("// user rules");
		expect(parse(await readFile(filePath, "utf8"))).toEqual({
			permissions: [
				{ action: "shell", resource: "*", effect: "allow" },
				{ action: "suggest", resource: "*", effect: "deny" },
			],
		});
	});

	it("changes its own permission rule in place, leaving rules around it alone", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		const config = new KiloConfigManager(configDirectory);
		await config.setPermissionEntry(SOURCE_ONE, "bash", "ask");
		const userRule = { action: "edit", resource: "*.md", effect: "allow" };
		const current = parse(await readFile(filePath, "utf8")) as { permissions: unknown[] };
		await writeFile(filePath, JSON.stringify({ permissions: [...current.permissions, userRule] }));

		await expect(config.setPermissionEntry(SOURCE_ONE, "bash", "deny")).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		expect(parse(await readFile(filePath, "utf8"))).toEqual({
			permissions: [{ action: "shell", resource: "*", effect: "deny" }, userRule],
		});
	});

	it("leaves a user-authored permission rule for the same tool alone", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		const userRules = {
			permission: { suggest: "deny" },
			permissions: [{ action: "suggest", resource: "*", effect: "allow" }],
		};
		await writeFile(filePath, JSON.stringify(userRules));
		const config = new KiloConfigManager(configDirectory);

		await expect(config.setPermissionEntry(SOURCE_ONE, "suggest", "deny")).resolves.toEqual({
			kind: "skipped",
			reason: "entry-not-owned",
		});
		expect(parse(await readFile(filePath, "utf8"))).toEqual(userRules);
	});

	it("adopts a user-authored permission rule that already says the same", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		await writeFile(
			filePath,
			JSON.stringify({ permissions: [{ action: "suggest", resource: "*", effect: "deny" }] }),
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(config.setPermissionEntry(SOURCE_ONE, "suggest", "deny")).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		await expect(config.setPermissionEntry(SOURCE_ONE, "suggest", "allow")).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		expect(parse(await readFile(filePath, "utf8"))).toEqual({
			permissions: [{ action: "suggest", resource: "*", effect: "allow" }],
		});
	});

	it("refuses to touch a permissions value that isn't a list", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		await writeFile(filePath, JSON.stringify({ permissions: { suggest: "allow" } }));
		const config = new KiloConfigManager(configDirectory);

		await expect(config.setPermissionEntry(SOURCE_ONE, "suggest", "deny")).resolves.toMatchObject({
			kind: "skipped-error",
		});
	});

	it("removes only sidecar-owned entries", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setMcpEntry(SOURCE_ONE, "owned", {
			type: "remote",
			url: "https://owned.test",
		});

		await expect(config.removeMcpEntry(SOURCE_ONE, "owned")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		expect(await mcpServers()).not.toHaveProperty("owned");
		await expect(
			readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		).rejects.toThrow(/ENOENT/);
	});

	it("prevents one source from overwriting or removing another source's entry", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setMcpEntry(SOURCE_ONE, "shared", {
			type: "remote",
			url: "https://one.test/mcp",
		});

		await expect(
			config.setMcpEntry(SOURCE_TWO, "shared", {
				type: "remote",
				url: "https://two.test/mcp",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "owned-by-other-source" });
		await expect(config.removeMcpEntry(SOURCE_TWO, "shared")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		expect((await mcpServers())?.shared).toEqual({
			type: "remote",
			url: "https://one.test/mcp",
		});

		await expect(
			config.setMcpEntry(SOURCE_ONE, "shared", {
				type: "remote",
				url: "https://one.test/updated",
			}),
		).resolves.toMatchObject({ kind: "written" });
		expect((await mcpServers())?.shared).toMatchObject({
			url: "https://one.test/updated",
		});
	});

	it("snapshots entries before queued writes", async () => {
		const config = new KiloConfigManager(configDirectory);
		const entry: Record<string, unknown> = { type: "remote", url: "https://original.test" };
		const writing = config.setMcpEntry(SOURCE_ONE, "snapshot", entry);
		entry.url = "https://mutated.test";

		await writing;
		expect((await mcpServers())?.snapshot).toMatchObject({
			url: "https://original.test",
		});
	});

	it("creates, updates, and removes a Desktop-owned provider", async () => {
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.setProviderEntry(SOURCE_ONE, "kilo-desktop-model-server", {
				name: "Local",
				npm: "@ai-sdk/openai-compatible",
				options: { baseURL: "http://127.0.0.1:43123/v1" },
			}),
		).resolves.toEqual({ kind: "written", reason: "created" });
		await expect(
			config.setProviderEntry(SOURCE_ONE, "kilo-desktop-model-server", {
				name: "Local inference",
				npm: "@ai-sdk/openai-compatible",
				options: { baseURL: "http://127.0.0.1:43124/v1" },
			}),
		).resolves.toEqual({ kind: "written", reason: "updated" });
		expect((await readConfig()).providers?.["kilo-desktop-model-server"]).toEqual({
			name: "Local inference",
			package: "@ai-sdk/openai-compatible",
			settings: { baseURL: "http://127.0.0.1:43124/v1" },
		});

		await expect(
			config.removeProviderEntry(SOURCE_ONE, "kilo-desktop-model-server"),
		).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		expect((await readConfig()).providers).not.toHaveProperty("kilo-desktop-model-server");
	});

	it("migrates legacy ownership and renames the Desktop-owned local provider", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({ providers: { "anaconda-local": { name: "Local" } } })}\n`,
		);
		await writeFile(
			path.join(configDirectory, LEGACY_OWNERSHIP_SIDECAR_FILENAME),
			`${JSON.stringify({
				version: 4,
				ownedEntryKeys: ["provider:anaconda-local"],
				owners: { "provider:anaconda-local": "local-inference" },
			})}\n`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.replaceProviderEntry("local-inference", "kilo-desktop-model-server", {
				name: "Local model server",
			}),
		).resolves.toEqual({ kind: "written", reason: "updated" });

		expect((await readConfig()).providers).toEqual({
			"kilo-desktop-model-server": { name: "Local model server" },
		});
		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { ownedEntryKeys: string[]; owners: Record<string, string> };
		expect(sidecar.ownedEntryKeys).toEqual(["provider:kilo-desktop-model-server"]);
		expect(sidecar.owners).toEqual({
			"provider:kilo-desktop-model-server": "local-inference",
		});
		await expect(
			readFile(path.join(configDirectory, LEGACY_OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		).rejects.toThrow(/ENOENT/);
	});

	it("folds a legacy sidecar left beside the current one so its entries stay removable", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({
				mcp: {
					servers: {
						desktop: { type: "local" },
						notebooks: { type: "local" },
						"nteract-mcp": { type: "local" },
					},
				},
			})}\n`,
		);
		await writeFile(
			path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME),
			`${JSON.stringify({
				version: 4,
				ownedEntryKeys: ["mcp:desktop"],
				owners: { "mcp:desktop": "kilo-server" },
			})}\n`,
		);
		await writeFile(
			path.join(configDirectory, LEGACY_OWNERSHIP_SIDECAR_FILENAME),
			`${JSON.stringify({
				version: 4,
				ownedEntryKeys: ["mcp:desktop", "mcp:notebooks", "mcp:nteract-mcp"],
				owners: {
					"mcp:desktop": "stale-owner",
					"mcp:notebooks": "notebook",
					"mcp:nteract-mcp": "notebook",
				},
			})}\n`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(config.listOwnedEntryIds("mcp", "notebook")).resolves.toEqual([
			"notebooks",
			"nteract-mcp",
		]);
		await expect(config.listOwnedEntryIds("mcp", "kilo-server")).resolves.toEqual(["desktop"]);
		await expect(config.removeMcpEntry("notebook", "notebooks")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});

		expect(Object.keys((await mcpServers()) ?? {})).toEqual(["desktop", "nteract-mcp"]);
		await expect(
			readFile(path.join(configDirectory, LEGACY_OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		).rejects.toThrow(/ENOENT/);
	});

	it("removes the reserved legacy local provider without ownership metadata", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({ providers: { "anaconda-local": { name: "User local" } } })}\n`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.replaceProviderEntry("local-inference", "kilo-desktop-model-server", {
				name: "Local model server",
			}),
		).resolves.toEqual({ kind: "written", reason: "updated" });
		expect((await readConfig()).providers).toEqual({
			"kilo-desktop-model-server": { name: "Local model server" },
		});
	});

	it("refuses to overwrite an unowned renamed provider", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({
				providers: { "kilo-desktop-model-server": { name: "User server" } },
			})}\n`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.replaceProviderEntry("local-inference", "kilo-desktop-model-server", {
				name: "Local model server",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "entry-not-owned" });
		expect((await readConfig()).providers).toEqual({
			"kilo-desktop-model-server": { name: "User server" },
		});
	});

	it("preserves JSONC while refusing to overwrite a user-owned provider", async () => {
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		await writeFile(
			filePath,
			`{
  // keep this provider and comment
  "providers": {
    "user-local": { "name": "User local", "package": "@ai-sdk/openai-compatible" },
  },
  // keep unrelated settings
  "theme": "system",
}
`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.setProviderEntry(SOURCE_ONE, "user-local", {
				name: "Desktop local",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "entry-not-owned" });
		await expect(
			config.setProviderEntry(SOURCE_ONE, "kilo-desktop-model-server", {
				name: "Local",
			}),
		).resolves.toMatchObject({ kind: "written" });

		const text = await readFile(filePath, "utf8");
		expect(text).toContain("// keep this provider and comment");
		expect(text).toContain("// keep unrelated settings");
		expect((await readConfig()).providers).toEqual({
			"user-local": { name: "User local", package: "@ai-sdk/openai-compatible" },
			"kilo-desktop-model-server": { name: "Local" },
		});
	});

	it("owns the same entry id independently in mcp and provider sections", async () => {
		const config = new KiloConfigManager(configDirectory);

		await config.setMcpEntry(SOURCE_ONE, "shared", {
			type: "remote",
			url: "https://example.test/mcp",
		});
		await expect(
			config.setProviderEntry(SOURCE_TWO, "shared", {
				name: "Shared provider",
			}),
		).resolves.toMatchObject({ kind: "written" });

		const contents = await readConfig();
		expect((await mcpServers())?.shared).toMatchObject({ type: "remote" });
		expect(contents.providers?.shared).toEqual({ name: "Shared provider" });
		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { ownedEntryKeys: string[]; owners: Record<string, string> };
		expect(sidecar.ownedEntryKeys).toEqual(["mcp:shared", "provider:shared"]);
		expect(sidecar.owners).toEqual({
			"mcp:shared": SOURCE_ONE,
			"provider:shared": SOURCE_TWO,
		});
	});

	it("prevents one source from changing another source's provider", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setProviderEntry(SOURCE_ONE, "kilo-desktop-model-server", { name: "Local" });

		await expect(
			config.setProviderEntry(SOURCE_TWO, "kilo-desktop-model-server", { name: "Other" }),
		).resolves.toEqual({ kind: "skipped", reason: "owned-by-other-source" });
		await expect(
			config.removeProviderEntry(SOURCE_TWO, "kilo-desktop-model-server"),
		).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		expect((await readConfig()).providers?.["kilo-desktop-model-server"]).toEqual({
			name: "Local",
		});
	});

	it("skips an idempotent provider write without changing the config", async () => {
		const config = new KiloConfigManager(configDirectory);
		const entry = {
			name: "Local",
			options: { baseURL: "http://127.0.0.1:43123/v1" },
		};
		await config.setProviderEntry(SOURCE_ONE, "kilo-desktop-model-server", entry);
		const before = await readFile(path.join(configDirectory, KILO_V2_CONFIG_FILENAME), "utf8");

		await expect(
			config.setProviderEntry(SOURCE_ONE, "kilo-desktop-model-server", entry),
		).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});
		expect(await readFile(path.join(configDirectory, KILO_V2_CONFIG_FILENAME), "utf8")).toBe(
			before,
		);
	});

	it("migrates the current flat MCP ownership sidecar to section-qualified keys", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({
				mcp: { servers: { shared: { type: "remote", url: "https://one.test/mcp" } } },
			})}\n`,
		);
		await writeFile(
			path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME),
			`${JSON.stringify({
				version: 3,
				ownedEntryIds: ["shared"],
				owners: { shared: SOURCE_ONE },
			})}\n`,
		);
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.setProviderEntry(SOURCE_TWO, "shared", { name: "Shared provider" }),
		).resolves.toMatchObject({ kind: "written" });

		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { version: number; ownedEntryKeys: string[]; owners: Record<string, string> };
		expect(sidecar).toEqual({
			version: 4,
			ownedEntryKeys: ["mcp:shared", "provider:shared"],
			owners: {
				"mcp:shared": SOURCE_ONE,
				"provider:shared": SOURCE_TWO,
			},
		});
	});

	it("writes v2 MCP entries and warns about fields v2 has no place for", async () => {
		const warn = vi.fn();
		const config = new KiloConfigManager(configDirectory, { info() {}, warn, error() {} });
		const entry = { type: "local", command: ["server"], enabled: true, timeout: 500, stray: 1 };

		await expect(config.setMcpEntry(SOURCE_ONE, "server", entry)).resolves.toEqual({
			kind: "written",
			reason: "created",
		});
		await expect(config.setMcpEntry(SOURCE_ONE, "server", entry)).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});

		expect((await mcpServers())?.server).toEqual({
			type: "local",
			command: ["server"],
			disabled: false,
			timeout: { startup: 500, catalog: 500, execution: 500 },
		});
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('mcp "server": stray'));
	});
});
