import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	KILO_CONFIG_FILENAME,
	OWNERSHIP_SIDECAR_FILENAME,
	MCP_ENTRY_NAME,
	MCP_ENTRY_SOURCE_ID,
	WEBMCP_RELAY_ID,
	WEBMCP_RELAY_LABEL,
	WEBMCP_RELAY_PORT,
	reconcileWebMcpRelayConfig,
	type WebMcpRelayEntry,
} from "./webmcp-relay-config.js";

const APP_EXE = "/Applications/Kilo.app/Contents/MacOS/Kilo";
const RELAY_ENTRY = "/opt/app.asar.unpacked/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs";
const RELAY_VERSION = "4.0.0";
const fakeResolveRelay = () => ({ entry: RELAY_ENTRY, version: RELAY_VERSION });

// Identity-pinned rendezvous args (split-brain fix; see docs/webmcp.md §7).
const RELAY_ARGS = [
	"--port",
	String(WEBMCP_RELAY_PORT),
	"--relay-id",
	WEBMCP_RELAY_ID,
	"--label",
	WEBMCP_RELAY_LABEL,
] as const;

const EXPECTED_ENTRY: WebMcpRelayEntry = {
	type: "local",
	command: [APP_EXE, RELAY_ENTRY, ...RELAY_ARGS],
	environment: { ELECTRON_RUN_AS_NODE: "1" },
	enabled: true,
};

describe("reconcileWebMcpRelayConfig", () => {
	let tempDir: string;
	let configDir: string;
	let configFile: string;
	let sidecarFile: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "webmcp-relay-config-"));
		configDir = path.join(tempDir, "config", "kilo");
		configFile = path.join(configDir, KILO_CONFIG_FILENAME);
		sidecarFile = path.join(configDir, OWNERSHIP_SIDECAR_FILENAME);
		await mkdir(configDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function readConfig(): Promise<Record<string, unknown>> {
		const raw = await readFile(configFile, "utf8");
		return JSON.parse(raw) as Record<string, unknown>;
	}

	async function readOwnedEntryKeys(): Promise<readonly string[]> {
		const raw = await readFile(sidecarFile, "utf8");
		const parsed = JSON.parse(raw) as { ownedEntryKeys: string[] };
		return parsed.ownedEntryKeys;
	}

	it("writes to kilo.jsonc (not kilo.json)", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const raw = await readFile(configFile, "utf8");
		expect(raw).toContain(MCP_ENTRY_NAME);
		await expect(readFile(path.join(configDir, "kilo.json"), "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("creates the file with a schema-clean McpLocalConfig (no unknown top-level keys)", async () => {
		const outcome = await reconcileWebMcpRelayConfig({
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
		expect(await readOwnedEntryKeys()).toEqual([`mcp:${MCP_ENTRY_NAME}`]);
		const sidecar = JSON.parse(await readFile(sidecarFile, "utf8")) as {
			owners: Record<string, string>;
		};
		expect(sidecar.owners).toEqual({ [`mcp:${MCP_ENTRY_NAME}`]: MCP_ENTRY_SOURCE_ID });
	});

	it("writes an entry that matches Kilo's McpLocalConfig schema shape", async () => {
		await reconcileWebMcpRelayConfig({
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
		expect(entry).not.toHaveProperty("ownedBy");
		expect(entry).not.toHaveProperty("args");
		expect(entry).not.toHaveProperty("env");
	});

	it("pins the relay identity and port (split-brain guard, docs/webmcp.md §7)", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const config = await readConfig();
		const entry = (config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME] as {
			command: string[];
		};
		// Without these args the widget can pair with a foreign/orphaned relay
		// on 9333 while kilo's own relay sits elsewhere with zero producers.
		expect(entry.command).toContain("--relay-id");
		expect(entry.command[entry.command.indexOf("--relay-id") + 1]).toBe(WEBMCP_RELAY_ID);
		expect(entry.command).toContain("--port");
		expect(entry.command[entry.command.indexOf("--port") + 1]).toBe(String(WEBMCP_RELAY_PORT));
		// Port must stay inside the CSP-allowed loopback WS range (9333-9348),
		// see apps/desktop/src/main/platform/ElectronProtocol.ts RELAY_WS_SOURCES.
		expect(WEBMCP_RELAY_PORT).toBeGreaterThanOrEqual(9333);
		expect(WEBMCP_RELAY_PORT).toBeLessThanOrEqual(9348);
	});

	it("is idempotent: a second run returns 'up-to-date' and does not touch the files", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const beforeConfig = await readFile(configFile, "utf8");
		const beforeSidecar = await readFile(sidecarFile, "utf8");

		const outcome = await reconcileWebMcpRelayConfig({
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
  // Kilo global config; partly owned by Kilo Desktop.
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

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });

		const raw = await readFile(configFile, "utf8");
		expect(raw).toContain("// Kilo global config; partly owned by Kilo Desktop.");
		expect(raw).toContain("// user's own MCP servers");
		expect(raw).toContain("$schema");
		expect(raw).toContain("my-custom");
		expect(raw).toContain(MCP_ENTRY_NAME);
	});

	it("refuses to write (skipped-error) when the existing file is unparseable, never clobbering", async () => {
		const badBody = "this is not JSON at all";
		await writeFile(configFile, badBody);

		const outcome = await reconcileWebMcpRelayConfig({
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

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome.kind).toBe("skipped-error");
		expect(await readFile(configFile, "utf8")).toBe(badBody);
	});

	it("recomputes absolute paths on every boot so app upgrades self-heal", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		const NEW_EXE = APP_EXE.replace("Kilo.app", "Kilo v2.app");
		const NEW_ENTRY = RELAY_ENTRY.replace("dist/cli.mjs", "dist/cli-v2.mjs");

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: NEW_EXE,
			resolveRelay: () => ({ entry: NEW_ENTRY, version: RELAY_VERSION }),
		});

		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });
		const config = await readConfig();
		const entry = (config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME];
		expect(entry).toMatchObject({ type: "local", command: [NEW_EXE, NEW_ENTRY, ...RELAY_ARGS] });
	});

	it("skips initialization when the user replaces our entry with an entry Desktop does not own (sidecar gone)", async () => {
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

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "skipped", reason: "entry-not-owned" });
		const config = await readConfig();
		expect((config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME]).toMatchObject({
			command: ["/my/custom/node", "/my/relay.js"],
		});
	});

	it("removes the Desktop-owned entry when disabled=false (fuse-off / downgrade path)", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		const outcome = await reconcileWebMcpRelayConfig({
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

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			enabled: false,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "skipped", reason: "entry-not-owned" });
		const config = await readConfig();
		expect((config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME]).toMatchObject({
			command: ["/my/custom/node", "/my/relay.js"],
		});
	});

	it("is a no-op when disabled=false and no prior entry exists", async () => {
		const outcome = await reconcileWebMcpRelayConfig({
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
		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: () => {
				throw new Error("relay not installed");
			},
		});
		expect(outcome).toEqual({ kind: "skipped-error", reason: "relay not installed" });
	});

	it("treats an empty existing file as a fresh initialization", async () => {
		await writeFile(configFile, "");

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toMatchObject({ kind: "written", reason: "updated" });
		const config = await readConfig();
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
		expect(await readOwnedEntryKeys()).toEqual([`mcp:${MCP_ENTRY_NAME}`]);
	});

	it("creates the config directory when it does not exist", async () => {
		const deepDir = path.join(configDir, "not", "yet", "created");
		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: deepDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(outcome.kind).toBe("written");
		const raw = await readFile(path.join(deepDir, KILO_CONFIG_FILENAME), "utf8");
		expect(raw).toContain(MCP_ENTRY_NAME);
		const sidecar = await readFile(path.join(deepDir, OWNERSHIP_SIDECAR_FILENAME), "utf8");
		expect(JSON.parse(sidecar).ownedEntryKeys).toEqual([`mcp:${MCP_ENTRY_NAME}`]);
	});

	it("recovers when a prior initialization crashed after writing the sidecar but before writing kilo.jsonc", async () => {
		// This is the crash window the new write ordering (sidecar first,
		// config second) is designed to survive. Simulate the intermediate
		// state and verify the next boot self-heals — i.e. sees the sidecar
		// marker, treats the entry as ours, and writes the missing config.
		// The old (config-first) ordering would strand the crash state
		// forever: config-with-no-marker was treated as "not owned by Desktop".
		await writeFile(
			sidecarFile,
			`${JSON.stringify({ version: 3, ownedEntryIds: [MCP_ENTRY_NAME], owners: {} }, undefined, 2)}\n`,
		);
		// No kilo.jsonc yet.

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toMatchObject({ kind: "written" });
		const config = await readConfig();
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
	});

	it("recovers when a prior initialization crashed after writing a stale config but before updating the sidecar version", async () => {
		// Also covered by the "recomputes absolute paths on every boot" case,
		// but with an explicit crash-window framing. Sidecar says we own the
		// entry; kilo.jsonc has an older path than the current process.
		// The initializer must overwrite the entry to match the new paths.
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
			`${JSON.stringify({ version: 3, ownedEntryIds: [MCP_ENTRY_NAME], owners: {} }, undefined, 2)}\n`,
		);

		const outcome = await reconcileWebMcpRelayConfig({
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

		const outcome = await reconcileWebMcpRelayConfig({
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
