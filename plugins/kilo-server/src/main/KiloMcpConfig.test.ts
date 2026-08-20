import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	KILO_CONFIG_FILENAME,
	OWNERSHIP_SIDECAR_FILENAME,
	KiloMcpConfig,
} from "./KiloMcpConfig.js";

const LEGACY_SIDECAR_FILENAME = ".anaconda-desktop-managed.json";

const SOURCE_ONE = "feature-one";
const SOURCE_TWO = "feature-two";

describe("KiloMcpConfig", () => {
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

	async function readConfig(): Promise<{ mcp: Record<string, unknown> }> {
		return parse(await readFile(path.join(configDirectory, KILO_CONFIG_FILENAME), "utf8")) as {
			mcp: Record<string, unknown>;
		};
	}

	it("serializes concurrent writers so both Desktop-owned entries survive", async () => {
		const config = new KiloMcpConfig(configDirectory);

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
		) as { ownedEntryIds: string[]; owners: Record<string, string> };
		expect(sidecar.ownedEntryIds).toEqual(["one", "two"]);
		expect(sidecar.owners).toEqual({ one: SOURCE_ONE, two: SOURCE_TWO });
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
		const config = new KiloMcpConfig(configDirectory);

		await expect(
			config.setMcpEntry(SOURCE_ONE, "shared", {
				type: "remote",
				url: "https://desktop.test",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "entry-not-owned" });
		expect(await readFile(filePath, "utf8")).toContain("// user-owned entry");
		expect((await readConfig()).mcp.shared).toEqual({
			type: "remote",
			url: "https://user.test",
		});
	});

	it("removes only sidecar-owned entries", async () => {
		const config = new KiloMcpConfig(configDirectory);
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
		const config = new KiloMcpConfig(configDirectory);
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
		expect((await readConfig()).mcp.shared).toEqual({
			type: "remote",
			url: "https://one.test/mcp",
		});

		await expect(
			config.setMcpEntry(SOURCE_ONE, "shared", {
				type: "remote",
				url: "https://one.test/updated",
			}),
		).resolves.toMatchObject({ kind: "written" });
		expect((await readConfig()).mcp.shared).toMatchObject({
			url: "https://one.test/updated",
		});
	}, 15_000);

	it("migrates the legacy sidecar and adopts an ownerless entry", async () => {
		await writeFile(
			path.join(configDirectory, KILO_CONFIG_FILENAME),
			`${JSON.stringify({
				mcp: { legacy: { type: "remote", url: "https://legacy.test/mcp" } },
			})}\n`,
		);
		await writeFile(
			path.join(configDirectory, LEGACY_SIDECAR_FILENAME),
			`${JSON.stringify({ version: 1, managed: ["legacy"] })}\n`,
		);
		const config = new KiloMcpConfig(configDirectory);

		await expect(
			config.setMcpEntry(SOURCE_ONE, "legacy", {
				type: "remote",
				url: "https://legacy.test/mcp",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "up-to-date" });

		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { version: number; ownedEntryIds: string[]; owners: Record<string, string> };
		expect(sidecar).toMatchObject({
			version: 3,
			ownedEntryIds: ["legacy"],
			owners: { legacy: SOURCE_ONE },
		});
		await expect(
			readFile(path.join(configDirectory, LEGACY_SIDECAR_FILENAME), "utf8"),
		).rejects.toThrow(/ENOENT/);
		await expect(config.removeMcpEntry(SOURCE_TWO, "legacy")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
	});

	it("preserves source ownership when migrating a version 2 sidecar", async () => {
		await writeFile(
			path.join(configDirectory, KILO_CONFIG_FILENAME),
			`${JSON.stringify({
				mcp: { shared: { type: "remote", url: "https://one.test/mcp" } },
			})}\n`,
		);
		await writeFile(
			path.join(configDirectory, LEGACY_SIDECAR_FILENAME),
			`${JSON.stringify({
				version: 2,
				managed: ["shared"],
				owners: { shared: SOURCE_ONE },
			})}\n`,
		);
		const config = new KiloMcpConfig(configDirectory);

		await expect(
			config.setMcpEntry(SOURCE_TWO, "shared", {
				type: "remote",
				url: "https://two.test/mcp",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "owned-by-other-source" });

		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME), "utf8"),
		) as { ownedEntryIds: string[]; owners: Record<string, string> };
		expect(sidecar).toMatchObject({
			ownedEntryIds: ["shared"],
			owners: { shared: SOURCE_ONE },
		});
		await expect(
			readFile(path.join(configDirectory, LEGACY_SIDECAR_FILENAME), "utf8"),
		).rejects.toThrow(/ENOENT/);
	});

	it("snapshots entries before queued writes", async () => {
		const config = new KiloMcpConfig(configDirectory);
		const entry: Record<string, unknown> = { type: "remote", url: "https://original.test" };
		const writing = config.setMcpEntry(SOURCE_ONE, "snapshot", entry);
		entry.url = "https://mutated.test";

		await writing;
		expect((await readConfig()).mcp.snapshot).toMatchObject({
			url: "https://original.test",
		});
	});
});
