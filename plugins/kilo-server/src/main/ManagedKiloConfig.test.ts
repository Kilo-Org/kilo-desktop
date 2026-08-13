import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	KILO_CONFIG_FILENAME,
	MANAGED_SIDECAR_FILENAME,
	ManagedKiloConfig,
} from "./ManagedKiloConfig.js";

const SOURCE_ONE = "feature-one";
const SOURCE_TWO = "feature-two";

describe("ManagedKiloConfig", () => {
	let tempDirectory: string;
	let configDirectory: string;

	beforeEach(async () => {
		tempDirectory = await mkdtemp(path.join(tmpdir(), "managed-kilo-config-"));
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

	it("serializes concurrent writers so both managed entries survive", async () => {
		const config = new ManagedKiloConfig(configDirectory);

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
			await readFile(path.join(configDirectory, MANAGED_SIDECAR_FILENAME), "utf8"),
		) as { managed: string[]; owners: Record<string, string> };
		expect(sidecar.managed).toEqual(["one", "two"]);
		expect(sidecar.owners).toEqual({ one: SOURCE_ONE, two: SOURCE_TWO });
	});

	it("preserves user comments and refuses to claim an unmanaged entry", async () => {
		const filePath = path.join(configDirectory, KILO_CONFIG_FILENAME);
		await writeFile(
			filePath,
			`{
  // user-owned entry
  "mcp": { "shared": { "type": "remote", "url": "https://user.test" } }
}
`,
		);
		const config = new ManagedKiloConfig(configDirectory);

		await expect(
			config.setMcpEntry(SOURCE_ONE, "shared", {
				type: "remote",
				url: "https://desktop.test",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "unmanaged-entry" });
		expect(await readFile(filePath, "utf8")).toContain("// user-owned entry");
		expect((await readConfig()).mcp.shared).toEqual({
			type: "remote",
			url: "https://user.test",
		});
	});

	it("removes only sidecar-owned entries", async () => {
		const config = new ManagedKiloConfig(configDirectory);
		await config.setMcpEntry(SOURCE_ONE, "managed", {
			type: "remote",
			url: "https://managed.test",
		});

		await expect(config.removeMcpEntry(SOURCE_ONE, "managed")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		expect((await readConfig()).mcp).not.toHaveProperty("managed");
		await expect(
			readFile(path.join(configDirectory, MANAGED_SIDECAR_FILENAME), "utf8"),
		).rejects.toThrow(/ENOENT/);
	});

	it("prevents one source from overwriting or removing another source's entry", async () => {
		const config = new ManagedKiloConfig(configDirectory);
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
	});

	it("adopts a legacy managed entry once and records its source owner", async () => {
		await writeFile(
			path.join(configDirectory, KILO_CONFIG_FILENAME),
			`${JSON.stringify({
				mcp: { legacy: { type: "remote", url: "https://legacy.test/mcp" } },
			})}\n`,
		);
		await writeFile(
			path.join(configDirectory, MANAGED_SIDECAR_FILENAME),
			`${JSON.stringify({ version: 1, managed: ["legacy"] })}\n`,
		);
		const config = new ManagedKiloConfig(configDirectory);

		await expect(
			config.setMcpEntry(SOURCE_ONE, "legacy", {
				type: "remote",
				url: "https://legacy.test/mcp",
			}),
		).resolves.toEqual({ kind: "skipped", reason: "up-to-date" });

		const sidecar = JSON.parse(
			await readFile(path.join(configDirectory, MANAGED_SIDECAR_FILENAME), "utf8"),
		) as { version: number; owners: Record<string, string> };
		expect(sidecar).toMatchObject({
			version: 2,
			owners: { legacy: SOURCE_ONE },
		});
		await expect(config.removeMcpEntry(SOURCE_TWO, "legacy")).resolves.toEqual({
			kind: "skipped",
			reason: "owned-by-other-source",
		});
	});

	it("snapshots entries before queued writes", async () => {
		const config = new ManagedKiloConfig(configDirectory);
		const entry: Record<string, unknown> = { type: "remote", url: "https://original.test" };
		const writing = config.setMcpEntry(SOURCE_ONE, "snapshot", entry);
		entry.url = "https://mutated.test";

		await writing;
		expect((await readConfig()).mcp.snapshot).toMatchObject({
			url: "https://original.test",
		});
	});
});
