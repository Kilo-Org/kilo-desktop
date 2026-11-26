import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readDesktopConfig } from "../../test/agent/desktop-config.js";
import { KILO_CONFIG_FILENAME, OWNERSHIP_SIDECAR_FILENAME } from "./KiloConfigManager.js";
import {
	MCP_ENTRY_NAME,
	MCP_ENTRY_SOURCE_ID,
	reconcileWebMcpRelayConfig,
	webMcpChannelFromStorageDir,
	type WebMcpRelayEntry,
} from "./webmcp-relay-config.js";

// The URL and token are per launch, so the entry references them through
// Kilo's {env:} substitution and Kilo reads them from the `kilo serve` env.
const EXPECTED_ENTRY: WebMcpRelayEntry = {
	type: "remote",
	url: "{env:KILO_DESKTOP_WEBMCP_URL}",
	oauth: false,
	headers: { Authorization: "Bearer {env:KILO_DESKTOP_WEBMCP_TOKEN}" },
	// Desktop's tools stay direct, named calls rather than Kilo's Code Mode.
	codemode: false,
};

describe("reconcileWebMcpRelayConfig", () => {
	let tempDir: string;
	let configDir: string;
	let configFile: string;
	let sidecarFile: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "webmcp-relay-config-"));
		configDir = path.join(tempDir, "config", "kilo2");
		configFile = path.join(configDir, KILO_CONFIG_FILENAME);
		sidecarFile = path.join(configDir, OWNERSHIP_SIDECAR_FILENAME);
		await mkdir(configDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	/** The file, with its MCP servers under `mcp` (they live at `mcp.servers`). */
	const readConfig = () => readDesktopConfig(configFile);

	async function readOwnedEntryKeys(): Promise<readonly string[]> {
		const raw = await readFile(sidecarFile, "utf8");
		const parsed = JSON.parse(raw) as { ownedEntryKeys: string[] };
		return parsed.ownedEntryKeys;
	}

	it("writes to kilo2.jsonc, the file Kilo v2 reads as Desktop's layer", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});
		const raw = await readFile(configFile, "utf8");
		expect(raw).toContain(MCP_ENTRY_NAME);
		await expect(readFile(path.join(configDir, "kilo.jsonc"), "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("creates the file with a schema-clean remote MCP server under mcp.servers", async () => {
		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});

		expect(outcome).toEqual({ kind: "written", reason: "created", entry: EXPECTED_ENTRY });
		const config = await readConfig();
		// The file must have ONLY schema-allowed keys. Ownership tracking lives
		// in a sidecar file, not in the config.
		expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual({
			mcp: { servers: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } },
		});
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
		// The sidecar records ownership.
		expect(await readOwnedEntryKeys()).toEqual([`mcp:${MCP_ENTRY_NAME}`]);
		const sidecar = JSON.parse(await readFile(sidecarFile, "utf8")) as {
			owners: Record<string, string>;
		};
		expect(sidecar.owners).toEqual({ [`mcp:${MCP_ENTRY_NAME}`]: MCP_ENTRY_SOURCE_ID });
	});

	it("is idempotent: a second run returns 'up-to-date' and does not touch the files", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});
		const beforeConfig = await readFile(configFile, "utf8");
		const beforeSidecar = await readFile(sidecarFile, "utf8");

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
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
    "servers": {
      // user's own MCP servers
      "my-custom": {
        "type": "local",
        "command": ["python", "-m", "my_mcp"]
      }
    }
  }
}
`;
		await writeFile(configFile, jsoncBody);

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
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
		});
		expect(outcome.kind).toBe("skipped-error");
		expect(await readFile(configFile, "utf8")).toBe(badBody);
	});

	it("skips initialization when the user replaces our entry with an entry Desktop does not own (sidecar gone)", async () => {
		// Simulate: user hand-edited the file and deleted the sidecar.
		await writeFile(
			configFile,
			`{
  "mcp": {
    "servers": {
      "${MCP_ENTRY_NAME}": {
        "type": "local",
        "command": ["/my/custom/node", "/my/relay.js"],
        "environment": {}
      }
    }
  }
}
`,
		);
		// No sidecar written.

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});

		expect(outcome).toEqual({ kind: "skipped", reason: "entry-not-owned" });
		const config = await readConfig();
		expect((config.mcp as Record<string, unknown>)[MCP_ENTRY_NAME]).toMatchObject({
			command: ["/my/custom/node", "/my/relay.js"],
		});
	});

	it("removes the Desktop-owned entry when the MCP endpoint is unavailable", async () => {
		await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			enabled: false,
		});

		expect(outcome).toEqual({ kind: "removed", reason: "endpoint-unavailable" });
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
    "servers": {
      "${MCP_ENTRY_NAME}": {
        "type": "local",
        "command": ["/my/custom/node", "/my/relay.js"]
      }
    }
  }
}
`,
		);
		// No sidecar: entry is user-owned.

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
			enabled: false,
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
			enabled: false,
		});
		expect(outcome).toEqual({ kind: "skipped", reason: "nothing-to-remove" });
		await expect(readFile(configFile, "utf8")).rejects.toThrow(/ENOENT/);
		await expect(readFile(sidecarFile, "utf8")).rejects.toThrow(/ENOENT/);
	});

	it("treats an empty existing file as a fresh initialization", async () => {
		await writeFile(configFile, "");

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
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
		});
		expect(outcome.kind).toBe("written");
		const raw = await readFile(path.join(deepDir, KILO_CONFIG_FILENAME), "utf8");
		expect(raw).toContain(MCP_ENTRY_NAME);
		const sidecar = await readFile(path.join(deepDir, OWNERSHIP_SIDECAR_FILENAME), "utf8");
		expect(JSON.parse(sidecar).ownedEntryKeys).toEqual([`mcp:${MCP_ENTRY_NAME}`]);
	});

	it("recovers when a prior initialization crashed after writing the sidecar but before writing the config", async () => {
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
		// No config file yet.

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});

		expect(outcome).toMatchObject({ kind: "written" });
		const config = await readConfig();
		expect(config).toEqual({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } });
	});

	it("refuses to write when jsonc-parser's modify() throws (e.g. mcp.servers is a non-object value)", async () => {
		// A file with `"servers": null` (or any non-object there) hits an
		// exception path in `modify()` when we try to write `mcp.servers["<name>"]`.
		// The module's contract is "never throws for expected conditions", so
		// this must surface as `skipped-error` — never a partial write.
		await writeFile(
			configFile,
			`{
  "mcp": { "servers": null }
}
`,
		);
		const before = await readFile(configFile, "utf8");

		const outcome = await reconcileWebMcpRelayConfig({
			configDirectory: configDir,
		});

		expect(outcome.kind).toBe("skipped-error");
		if (outcome.kind === "skipped-error") {
			expect(outcome.reason).toMatch(/modify\(\)/);
		}
		expect(await readFile(configFile, "utf8")).toBe(before);
		await expect(readFile(sidecarFile, "utf8")).rejects.toThrow(/ENOENT/);
	});
});

describe("app channel", () => {
	it("maps plugin storage dirs onto the matching app channel", () => {
		expect(
			webMcpChannelFromStorageDir(
				"/Users/me/Library/Application Support/Kilo Desktop Dev/plugins/kilo-server",
			),
		).toBe("development");
		expect(
			webMcpChannelFromStorageDir(
				"/Users/me/Library/Application Support/Kilo Desktop Preview/plugins/kilo-server",
			),
		).toBe("preview");
		expect(
			webMcpChannelFromStorageDir(
				"/Users/me/Library/Application Support/Kilo Desktop/plugins/kilo-server",
			),
		).toBe("stable");
	});
});
