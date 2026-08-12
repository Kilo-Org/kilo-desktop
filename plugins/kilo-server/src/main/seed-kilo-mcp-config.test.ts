import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildWebMcpRelayOverlay,
	KILO_CONFIG_FILENAME,
	MANAGED_SIDECAR_FILENAME,
	MCP_ENTRY_NAME,
	WEBMCP_RELAY_ID,
	WEBMCP_RELAY_LABEL,
	WEBMCP_RELAY_PORT,
	seedKiloMcpConfig,
	type SeededMcpEntry,
} from "./seed-kilo-mcp-config.js";

const APP_EXE =
	"/Applications/Anaconda Agentic Desktop.app/Contents/MacOS/Anaconda Agentic Desktop";
const RELAY_ENTRY = "/opt/app.asar.unpacked/node_modules/@mcp-b/webmcp-local-relay/dist/cli.mjs";
const RELAY_VERSION = "4.0.0";
const fakeResolveRelay = () => ({ entry: RELAY_ENTRY, version: RELAY_VERSION });

const RELAY_ARGS = [
	"--port",
	String(WEBMCP_RELAY_PORT),
	"--relay-id",
	WEBMCP_RELAY_ID,
	"--label",
	WEBMCP_RELAY_LABEL,
] as const;

const EXPECTED_ENTRY: SeededMcpEntry = {
	type: "local",
	command: [APP_EXE, RELAY_ENTRY, ...RELAY_ARGS],
	environment: { ELECTRON_RUN_AS_NODE: "1" },
	enabled: true,
};

describe("buildWebMcpRelayOverlay", () => {
	it("builds the local MCP overlay with the pinned relay identity", () => {
		const result = buildWebMcpRelayOverlay({
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(result).toEqual({
			kind: "ok",
			version: RELAY_VERSION,
			entry: EXPECTED_ENTRY,
			overlay: { mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } },
		});
	});

	it("pins the relay identity and port (split-brain guard, docs/webmcp.md §7)", () => {
		const result = buildWebMcpRelayOverlay({
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		const command = result.entry.command;
		expect(command[command.indexOf("--relay-id") + 1]).toBe(WEBMCP_RELAY_ID);
		expect(command[command.indexOf("--port") + 1]).toBe(String(WEBMCP_RELAY_PORT));
		expect(WEBMCP_RELAY_PORT).toBeGreaterThanOrEqual(9333);
		expect(WEBMCP_RELAY_PORT).toBeLessThanOrEqual(9348);
	});

	it("returns skipped-error when the relay package cannot be resolved", () => {
		const result = buildWebMcpRelayOverlay({
			appExecutablePath: APP_EXE,
			resolveRelay: () => {
				throw new Error("relay missing");
			},
		});
		expect(result).toEqual({ kind: "skipped-error", reason: "relay missing" });
	});
});

describe("seedKiloMcpConfig stale-file cleanup", () => {
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

	it("removes a managed leftover entry when enabled=false (fuse-off / rollback)", async () => {
		await writeFile(
			configFile,
			`${JSON.stringify({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } }, null, 2)}\n`,
		);
		await writeFile(
			sidecarFile,
			`${JSON.stringify({ version: 1, managed: [MCP_ENTRY_NAME] }, null, 2)}\n`,
		);

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			enabled: false,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "removed", reason: "fuse-off" });
		const config = JSON.parse(await readFile(configFile, "utf8")) as {
			mcp?: Record<string, unknown>;
		};
		expect(config.mcp?.[MCP_ENTRY_NAME]).toBeUndefined();
	});

	it("when enabled, prunes stale file seed and reports the overlay entry", async () => {
		await writeFile(
			configFile,
			`${JSON.stringify({ mcp: { [MCP_ENTRY_NAME]: EXPECTED_ENTRY } }, null, 2)}\n`,
		);
		await writeFile(
			sidecarFile,
			`${JSON.stringify({ version: 1, managed: [MCP_ENTRY_NAME] }, null, 2)}\n`,
		);

		const outcome = await seedKiloMcpConfig({
			configDirectory: configDir,
			appExecutablePath: APP_EXE,
			resolveRelay: fakeResolveRelay,
		});

		expect(outcome).toEqual({ kind: "written", reason: "created", entry: EXPECTED_ENTRY });
		const config = JSON.parse(await readFile(configFile, "utf8")) as {
			mcp?: Record<string, unknown>;
		};
		expect(config.mcp?.[MCP_ENTRY_NAME]).toBeUndefined();
	});
});
