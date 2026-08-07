import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	KILO_CONFIG_FILENAME,
	MANAGED_SIDECAR_FILENAME,
	MCP_ENTRY_NAME,
	seedKiloMcpConfig,
	type SeededMcpEntry,
} from "./seed-kilo-mcp-config.js";

const APP_EXE =
	"/Applications/Anaconda Agentic Desktop.app/Contents/MacOS/Anaconda Agentic Desktop";
const RELAY_ENTRY = "/opt/app.asar.unpacked/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs";
const RELAY_VERSION = "4.0.0";
const fakeResolveRelay = () => ({ entry: RELAY_ENTRY, version: RELAY_VERSION });

const EXPECTED_ENTRY: SeededMcpEntry = {
	type: "local",
	command: [APP_EXE, RELAY_ENTRY],
	environment: { ELECTRON_RUN_AS_NODE: "1" },
	enabled: true,
};

describe("seedKiloMcpConfig", () => {
	let tempDir: string;
	let configDir: string;
	let configFile: string;
	let sidecarFile: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "seed-kilo-mcp-config-"));
		configDir = path.join(tempDir, "config", "kilo");
		configFile = path.join(configDir, KILO_CONFIG_FILENAME);
		sidecarFile = path.join(configDir, MANAGED_SIDECAR_FILENAME);
		await mkdir(configDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function readConfig(): Promise<Record<string, unknown>> {
		const raw = await readFile(configFile, "utf8");
		return JSON.parse(raw) as Record<string, unknown>;
	}

	async function readSidecarManaged(): Promise<readonly string[]> {
		const raw = await readFile(sidecarFile, "utf8");
		const parsed = JSON.parse(raw) as { managed: string[] };
		return parsed.managed;
	}

	it("writes to kilo.jsonc (not kilo.json)", async () => {
		await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const raw = await readFile(configFile, "utf8");
		expect(raw).toContain(MCP_ENTRY_NAME);
		await expect(readFile(path.join(configDir, "kilo.json"), "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("creates the file with a schema-clean McpLocalConfig (no unknown top-level keys)", async () => {
		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "written", reason: "created", entry: EXPECTED_ENTRY });
		const config = await readConfig();
		// kilo.jsonc must have ONLY schema-allowed top-level keys. Ownership
		// tracking lives in a sidecar file, not in kilo.jsonc.
		expect(Object.keys(config)).toEqual(["mcp"]);
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
		// The sidecar records ownership.
		expect(await readSidecarManaged()).toEqual([MCP_ENTRY_NAME]);
	});

	it("writes an entry that matches Kilo's McpLocalConfig schema shape", async () => {
		await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const config = await readConfig();
		const entry = (config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME] as Record<
			string,
			unknown
		>;
		expect(entry.type).toBe("local");
		expect(Array.isArray(entry.command)).toBe(true);
		expect(entry.environment).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
		expect(entry.enabled).toBe(true);
		// Fields that would fail Kilo's additionalProperties:false MUST be absent.
		expect(entry).not.toHaveProperty("managedBy");
		expect(entry).not.toHaveProperty("args");
		expect(entry).not.toHaveProperty("env");
	});

	it("is idempotent: a second run returns 'up-to-date' and does not touch the files", async () => {
		await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const beforeConfig = await readFile(configFile, "utf8");
		const beforeSidecar = await readFile(sidecarFile, "utf8");

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "skipped", reason: "up-to-date" });
		expect(await readFile(configFile, "utf8")).toBe(beforeConfig);
		expect(await readFile(sidecarFile, "utf8")).toBe(beforeSidecar);
	});

	it("preserves JSONC comments and unrelated sibling keys", async () => {
		const jsoncBody = `{
  // Kilo global config; managed partly by Anaconda Desktop.
  "$schema": "https://app.kilo.ai/config.json",
  "mcp": {
    // user's own MCP servers
    "my-custom": {
      "type": "local",
      "command": ["python", "-m", "my_mcp"]
    }
  }
}
`;
		await writeFile(configFile, jsoncBody);

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });

		const raw = await readFile(configFile, "utf8");
		expect(raw).toContain("// Kilo global config; managed partly by Anaconda Desktop.");
		expect(raw).toContain("// user's own MCP servers");
		expect(raw).toContain("$schema");
		expect(raw).toContain("my-custom");
		expect(raw).toContain(MCP_ENTRY_NAME);
	});

	it("refuses to write (skipped-error) when the existing file is unparseable, never clobbering", async () => {
		const badBody = "this is not JSON at all";
		await writeFile(configFile, badBody);

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome.kind).toBe("skipped-error");
		expect(await readFile(configFile, "utf8")).toBe(badBody);
		await expect(readFile(sidecarFile, "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("refuses to write when the top-level is a JSON scalar (not an object)", async () => {
		const badBody = '"just a string"\n';
		await writeFile(configFile, badBody);

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome.kind).toBe("skipped-error");
		expect(await readFile(configFile, "utf8")).toBe(badBody);
	});

	it("recomputes absolute paths on every boot so app upgrades self-heal", async () => {
		await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const NEW_EXE = APP_EXE.replace(
			"Anaconda Agentic Desktop.app",
			"Anaconda Agentic Desktop v2.app",
		);
		const NEW_ENTRY = RELAY_ENTRY.replace("dist/cli.mjs", "dist/cli-v2.mjs");

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: NEW_EXE,
			resolveRelay: () => ({ entry: NEW_ENTRY, version: RELAY_VERSION }),
		});

		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });
		const config = await readConfig();
		const entry = (config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME];
		expect(entry).toMatchObject({ type: "local", command: [NEW_EXE, NEW_ENTRY] });
	});

	it("skips seeding when the user replaces our entry with an unmanaged one (sidecar gone)", async () => {
		// Simulate: user hand-edited kilo.jsonc and deleted the sidecar.
		await writeFile(
			configFile,
			`{
  "mcp": {
    "${MCP_ENTRY_NAME}": {
      "type": "local",
      "command": ["/my/custom/node", "/my/relay.js"],
      "environment": {}
    }
  }
}
`,
		);
		// No sidecar written.

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "skipped", reason: "unmanaged-entry" });
		const config = await readConfig();
		expect((config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME]).toMatchObject({
			command: ["/my/custom/node", "/my/relay.js"],
		});
	});

	it("removes the managed entry when disabled=false (fuse-off / downgrade path)", async () => {
		await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			enabled: false,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "removed", reason: "fuse-off" });
		const config = await readConfig();
		expect((config.mcp as Record<string, unknown> | undefined) ?? {}).not.toHaveProperty(
			MCP_ENTRY_NAME,
		);
		// Sidecar pruned to empty → file removed to keep the config dir tidy.
		await expect(readFile(sidecarFile, "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("does not remove a user-owned entry with the same key when disabled=false", async () => {
		await writeFile(
			configFile,
			`{
  "mcp": {
    "${MCP_ENTRY_NAME}": {
      "type": "local",
      "command": ["/my/custom/node", "/my/relay.js"]
    }
  }
}
`,
		);
		// No sidecar: entry is user-owned.

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			enabled: false,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "skipped", reason: "unmanaged-entry" });
		const config = await readConfig();
		expect((config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME]).toMatchObject({
			command: ["/my/custom/node", "/my/relay.js"],
		});
	});

	it("is a no-op when disabled=false and no prior entry exists", async () => {
		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			enabled: false,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome).toEqual({ kind: "skipped", reason: "nothing-to-remove" });
		await expect(readFile(configFile, "utf8")).rejects.toThrow(/ENOENT/);
		await expect(readFile(sidecarFile, "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("returns a skipped-error outcome when the relay cannot be resolved (does not throw)", async () => {
		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: () => {
				throw new Error("relay not installed");
			},
		});
		expect(outcome).toEqual({ kind: "skipped-error", reason: "relay not installed" });
	});

	it("treats an empty existing file as a fresh seed", async () => {
		await writeFile(configFile, "");

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });
		const config = await readConfig();
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
		expect(await readSidecarManaged()).toEqual([MCP_ENTRY_NAME]);
	});

	it("creates the config directory when it does not exist", async () => {
		const deepDir = path.join(configDir, "not", "yet", "created");
		const outcome = await seedKiloMcpConfig({
			configDirectory: deepDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome.kind).toBe("written");
		const raw = await readFile(path.join(deepDir, KILO_CONFIG_FILENAME), "utf8");
		expect(raw).toContain(MCP_ENTRY_NAME);
		const sidecar = await readFile(path.join(deepDir, MANAGED_SIDECAR_FILENAME), "utf8");
		expect(JSON.parse(sidecar).managed).toEqual([MCP_ENTRY_NAME]);
	});

	it("recovers when a prior seed crashed after writing the sidecar but before writing kilo.jsonc", async () => {
		// This is the crash window the new write ordering (sidecar first,
		// config second) is designed to survive. Simulate the intermediate
		// state and verify the next boot self-heals — i.e. sees the sidecar
		// marker, treats the entry as ours, and writes the missing config.
		// The old (config-first) ordering would strand the crash state
		// forever: config-with-no-marker was treated as "unmanaged".
		await writeFile(
			sidecarFile,
			`${JSON.stringify({ version: 1, managed: [MCP_ENTRY_NAME] }, undefined, 2)}\n`,
		);
		// No kilo.jsonc yet.

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toMatchObject({ kind: "written" });
		const config = await readConfig();
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
	});

	it("recovers when a prior seed crashed after writing a stale config but before updating the sidecar version", async () => {
		// Also covered by the "recomputes absolute paths on every boot" case,
		// but with an explicit crash-window framing. Sidecar says we own the
		// entry; kilo.jsonc has an older path than the current process.
		// The seed must overwrite the entry to match the new paths.
		const staleEntry = {
			type: "local",
			command: ["/old/exe", "/old/relay.js"],
			environment: { ELECTRON_RUN_AS_NODE: "1" },
			enabled: true,
		};
		await writeFile(
			configFile,
			`${JSON.stringify({ mcp: { [MCP_ENTRY_NAME]: staleEntry } }, undefined, 2)}\n`,
		);
		await writeFile(
			sidecarFile,
			`${JSON.stringify({ version: 1, managed: [MCP_ENTRY_NAME] }, undefined, 2)}\n`,
		);

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });
		const config = await readConfig();
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
	});

	it("refuses to write when jsonc-parser's modify() throws (e.g. mcp is a non-object value)", async () => {
		// A user with `"mcp": null` (or any non-object at `mcp`) hits an
		// exception path in `modify()` when we try to write `mcp["<name>"]`.
		// The module's contract is "never throws for expected conditions", so
		// this must surface as `skipped-error` — never a partial write.
		await writeFile(
			configFile,
			`{
  "mcp": null
}
`,
		);
		const before = await readFile(configFile, "utf8");

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome.kind).toBe("skipped-error");
		if (outcome.kind === "skipped-error") {
			expect(outcome.reason).toMatch(/modify\(\)/);
		}
		expect(await readFile(configFile, "utf8")).toBe(before);
		await expect(readFile(sidecarFile, "utf8")).rejects.toThrow(/ENOENT/);
	});
});
