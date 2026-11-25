import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	KILO_V2_CONFIG_FILENAME,
	OWNERSHIP_SIDECAR_FILENAME,
	KiloConfigManager,
} from "./KiloConfigManager.js";

const SOURCE_ONE = "feature-one";
const SOURCE_TWO = "feature-two";

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
			config.setEntry("mcp.servers", SOURCE_ONE, "one", {
				type: "remote",
				url: "https://one.test/mcp",
			}),
			config.setEntry("mcp.servers", SOURCE_TWO, "two", {
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
		) as { owners: Record<string, string> };
		expect(sidecar.owners).toEqual({
			"mcp.servers:one": SOURCE_ONE,
			"mcp.servers:two": SOURCE_TWO,
		});
	});

	it("lists only MCP entries owned by the requested source", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setEntry("mcp.servers", SOURCE_ONE, "one", {
			type: "remote",
			url: "https://example.test",
		});
		await config.setEntry("mcp.servers", SOURCE_ONE, "two", {
			type: "remote",
			url: "https://example.test",
		});
		await config.setEntry("mcp.servers", SOURCE_TWO, "other", {
			type: "remote",
			url: "https://example.test",
		});
		await config.setEntry("providers", SOURCE_ONE, "provider", { name: "Provider" });

		await expect(config.listOwnedEntryIds("mcp.servers", SOURCE_ONE)).resolves.toEqual([
			"one",
			"two",
		]);
		await expect(config.listOwnedEntryIds("mcp.servers", SOURCE_TWO)).resolves.toEqual(["other"]);
	});

	it("owns agent and command entries per section and source, beside the user's", async () => {
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			`${JSON.stringify({ agents: { mine: { system: "user agent" } } })}\n`,
		);
		const config = new KiloConfigManager(configDirectory);
		const reviewer = { description: "Reviews", system: "Review it.", mode: "subagent" as const };

		await expect(config.setEntry("agents", SOURCE_ONE, "reviewer", reviewer)).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		await config.setEntry("commands", SOURCE_ONE, "reviewer", { template: "Review $ARGUMENTS" });
		await config.setEntry("commands", SOURCE_TWO, "other", { template: "Other" });
		await expect(
			config.setEntry("agents", SOURCE_ONE, "mine", { system: "taken over" }),
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
		await expect(config.listOwnedEntryIds("agents", SOURCE_ONE)).resolves.toEqual(["reviewer"]);
		await expect(config.listOwnedEntryIds("commands", SOURCE_ONE)).resolves.toEqual(["reviewer"]);
		await expect(config.listOwnedEntryIds("mcp.servers", SOURCE_ONE)).resolves.toEqual([]);

		await expect(config.removeEntry("agents", SOURCE_ONE, "reviewer")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		await expect(config.removeEntry("commands", SOURCE_ONE, "other")).resolves.toEqual({
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
			config.setEntry("mcp.servers", SOURCE_ONE, "shared", {
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

	it("removes only sidecar-owned entries", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setEntry("mcp.servers", SOURCE_ONE, "owned", {
			type: "remote",
			url: "https://owned.test",
		});

		await expect(config.removeEntry("mcp.servers", SOURCE_ONE, "owned")).resolves.toEqual({
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
		await config.setEntry("mcp.servers", SOURCE_ONE, "shared", {
			type: "remote",
			url: "https://one.test/mcp",
		});

		await expect(
			config.setEntry("mcp.servers", SOURCE_TWO, "shared", {
				type: "remote",
				url: "https://two.test/mcp",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "owned-by-other-source" });
		await expect(config.removeEntry("mcp.servers", SOURCE_TWO, "shared")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		expect((await mcpServers())?.shared).toEqual({
			type: "remote",
			url: "https://one.test/mcp",
		});

		await expect(
			config.setEntry("mcp.servers", SOURCE_ONE, "shared", {
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
		const entry = { type: "remote" as const, url: "https://original.test" };
		const writing = config.setEntry("mcp.servers", SOURCE_ONE, "snapshot", entry);
		entry.url = "https://mutated.test";

		await writing;
		expect((await mcpServers())?.snapshot).toMatchObject({
			url: "https://original.test",
		});
	});

	it("creates, updates, and removes a Desktop-owned provider", async () => {
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.setEntry("providers", SOURCE_ONE, "kilo-desktop-model-server", {
				name: "Local",
				package: "@ai-sdk/openai-compatible",
				settings: { baseURL: "http://127.0.0.1:43123/v1" },
			}),
		).resolves.toEqual({ kind: "written", reason: "created" });
		await expect(
			config.setEntry("providers", SOURCE_ONE, "kilo-desktop-model-server", {
				name: "Local inference",
				package: "@ai-sdk/openai-compatible",
				settings: { baseURL: "http://127.0.0.1:43124/v1" },
			}),
		).resolves.toEqual({ kind: "written", reason: "updated" });
		expect((await readConfig()).providers?.["kilo-desktop-model-server"]).toEqual({
			name: "Local inference",
			package: "@ai-sdk/openai-compatible",
			settings: { baseURL: "http://127.0.0.1:43124/v1" },
		});

		await expect(
			config.removeEntry("providers", SOURCE_ONE, "kilo-desktop-model-server"),
		).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		expect((await readConfig()).providers).not.toHaveProperty("kilo-desktop-model-server");
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
			config.setEntry("providers", SOURCE_ONE, "user-local", {
				name: "Desktop local",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "entry-not-owned" });
		await expect(
			config.setEntry("providers", SOURCE_ONE, "kilo-desktop-model-server", {
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

	it("owns the same entry id independently in the mcp.servers and providers sections", async () => {
		const config = new KiloConfigManager(configDirectory);

		await config.setEntry("mcp.servers", SOURCE_ONE, "shared", {
			type: "remote",
			url: "https://example.test/mcp",
		});
		await expect(
			config.setEntry("providers", SOURCE_TWO, "shared", {
				name: "Shared provider",
			}),
		).resolves.toMatchObject({ kind: "written" });

		const contents = await readConfig();
		expect((await mcpServers())?.shared).toMatchObject({ type: "remote" });
		expect(contents.providers?.shared).toEqual({ name: "Shared provider" });
		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { owners: Record<string, string> };
		expect(sidecar.owners).toEqual({
			"mcp.servers:shared": SOURCE_ONE,
			"providers:shared": SOURCE_TWO,
		});
	});

	it("prevents one source from changing another source's provider", async () => {
		const config = new KiloConfigManager(configDirectory);
		await config.setEntry("providers", SOURCE_ONE, "kilo-desktop-model-server", { name: "Local" });

		await expect(
			config.setEntry("providers", SOURCE_TWO, "kilo-desktop-model-server", { name: "Other" }),
		).resolves.toEqual({ kind: "skipped", reason: "owned-by-other-source" });
		await expect(
			config.removeEntry("providers", SOURCE_TWO, "kilo-desktop-model-server"),
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
			settings: { baseURL: "http://127.0.0.1:43123/v1" },
		};
		await config.setEntry("providers", SOURCE_ONE, "kilo-desktop-model-server", entry);
		const before = await readFile(path.join(configDirectory, KILO_V2_CONFIG_FILENAME), "utf8");

		await expect(
			config.setEntry("providers", SOURCE_ONE, "kilo-desktop-model-server", entry),
		).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});
		expect(await readFile(path.join(configDirectory, KILO_V2_CONFIG_FILENAME), "utf8")).toBe(
			before,
		);
	});
});
