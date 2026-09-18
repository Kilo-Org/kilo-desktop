import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	KILO_CONFIG_FILENAME,
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

	async function readConfig(): Promise<{
		mcp?: Record<string, unknown>;
		provider?: Record<string, unknown>;
	}> {
		return parse(await readFile(path.join(configDirectory, KILO_CONFIG_FILENAME), "utf8")) as {
			mcp?: Record<string, unknown>;
			provider?: Record<string, unknown>;
		};
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

		expect((await readConfig()).mcp).toEqual({
			one: { type: "remote", url: "https://one.test/mcp" },
			two: { type: "remote", url: "https://two.test/mcp" },
		});
		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { ownedEntryKeys: string[]; owners: Record<string, string> };
		expect(sidecar.ownedEntryKeys).toEqual(["mcp:one", "mcp:two"]);
		expect(sidecar.owners).toEqual({ "mcp:one": SOURCE_ONE, "mcp:two": SOURCE_TWO });
	});

	it("preserves user comments and refuses to claim an entry Desktop does not own", async () => {
		const filePath = path.join(configDirectory, KILO_CONFIG_FILENAME);
		await writeFile(
			filePath,
			`{
  // user-owned entry
  "mcp": { "shared": { "type": "remote", "url": "https://user.test" } }
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
		expect((await readConfig()).mcp?.shared).toEqual({
			type: "remote",
			url: "https://user.test",
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
		expect((await readConfig()).mcp).not.toHaveProperty("owned");
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
		expect((await readConfig()).mcp?.shared).toEqual({
			type: "remote",
			url: "https://one.test/mcp",
		});

		await expect(
			config.setMcpEntry(SOURCE_ONE, "shared", {
				type: "remote",
				url: "https://one.test/updated",
			}),
		).resolves.toMatchObject({ kind: "written" });
		expect((await readConfig()).mcp?.shared).toMatchObject({
			url: "https://one.test/updated",
		});
	}, 15_000);

	it("snapshots entries before queued writes", async () => {
		const config = new KiloConfigManager(configDirectory);
		const entry: Record<string, unknown> = { type: "remote", url: "https://original.test" };
		const writing = config.setMcpEntry(SOURCE_ONE, "snapshot", entry);
		entry.url = "https://mutated.test";

		await writing;
		expect((await readConfig()).mcp?.snapshot).toMatchObject({
			url: "https://original.test",
		});
	});

	it("creates, updates, and removes a Desktop-owned provider", async () => {
		const config = new KiloConfigManager(configDirectory);

		await expect(
			config.setProviderEntry(SOURCE_ONE, "anaconda-local", {
				name: "Local",
				npm: "@ai-sdk/openai-compatible",
				options: { baseURL: "http://127.0.0.1:43123/v1" },
			}),
		).resolves.toEqual({ kind: "written", reason: "created" });
		await expect(
			config.setProviderEntry(SOURCE_ONE, "anaconda-local", {
				name: "Local inference",
				npm: "@ai-sdk/openai-compatible",
				options: { baseURL: "http://127.0.0.1:43124/v1" },
			}),
		).resolves.toEqual({ kind: "written", reason: "updated" });
		expect((await readConfig()).provider?.["anaconda-local"]).toEqual({
			name: "Local inference",
			npm: "@ai-sdk/openai-compatible",
			options: { baseURL: "http://127.0.0.1:43124/v1" },
		});

		await expect(config.removeProviderEntry(SOURCE_ONE, "anaconda-local")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		expect((await readConfig()).provider).not.toHaveProperty("anaconda-local");
	}, 15_000);

	it("preserves JSONC while refusing to overwrite a user-owned provider", async () => {
		const filePath = path.join(configDirectory, KILO_CONFIG_FILENAME);
		await writeFile(
			filePath,
			`{
  // keep this provider and comment
  "provider": {
    "user-local": { "name": "User local", "npm": "@ai-sdk/openai-compatible" },
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
			config.setProviderEntry(SOURCE_ONE, "anaconda-local", {
				name: "Local",
			}),
		).resolves.toMatchObject({ kind: "written" });

		const text = await readFile(filePath, "utf8");
		expect(text).toContain("// keep this provider and comment");
		expect(text).toContain("// keep unrelated settings");
		expect((await readConfig()).provider).toEqual({
			"user-local": { name: "User local", npm: "@ai-sdk/openai-compatible" },
			"anaconda-local": { name: "Local" },
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
		expect(contents.mcp?.shared).toMatchObject({ type: "remote" });
		expect(contents.provider?.shared).toEqual({ name: "Shared provider" });
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
		await config.setProviderEntry(SOURCE_ONE, "anaconda-local", { name: "Local" });

		await expect(
			config.setProviderEntry(SOURCE_TWO, "anaconda-local", { name: "Other" }),
		).resolves.toEqual({ kind: "skipped", reason: "owned-by-other-source" });
		await expect(config.removeProviderEntry(SOURCE_TWO, "anaconda-local")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
		expect((await readConfig()).provider?.["anaconda-local"]).toEqual({ name: "Local" });
	});

	it("skips an idempotent provider write without changing the config", async () => {
		const config = new KiloConfigManager(configDirectory);
		const entry = {
			name: "Local",
			options: { baseURL: "http://127.0.0.1:43123/v1" },
		};
		await config.setProviderEntry(SOURCE_ONE, "anaconda-local", entry);
		const before = await readFile(path.join(configDirectory, KILO_CONFIG_FILENAME), "utf8");

		await expect(config.setProviderEntry(SOURCE_ONE, "anaconda-local", entry)).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});
		expect(await readFile(path.join(configDirectory, KILO_CONFIG_FILENAME), "utf8")).toBe(before);
	});

	it("migrates the current flat MCP ownership sidecar to section-qualified keys", async () => {
		await writeFile(
			path.join(configDirectory, KILO_CONFIG_FILENAME),
			`${JSON.stringify({
				mcp: { shared: { type: "remote", url: "https://one.test/mcp" } },
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
});
