import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenCode } from "@kilocode/client";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getKiloCliArtifact } from "./cli-distribution/artifacts.js";
import { KILO_V2_CONFIG_FILENAME, KiloConfigManager } from "./KiloConfigManager.js";
import { KiloServerManager } from "./KiloServerManager.js";
import { reconcileWebMcpRelayConfig } from "./webmcp-relay-config.js";

function bundledKiloExecutable(): string | undefined {
	try {
		const artifact = getKiloCliArtifact();
		const packageJson = createRequire(import.meta.url).resolve(
			`${artifact.packageName}/package.json`,
		);
		const executable = path.join(path.dirname(packageJson), "bin", artifact.executable);
		return existsSync(executable) ? executable : undefined;
	} catch {
		return undefined;
	}
}

const kiloExecutable = bundledKiloExecutable();

/**
 * What the entries' `{env:NAME}` references resolve to: v2 substitutes them
 * when it reads the file, an unset one as "". The WebMCP endpoint's variables
 * are the server manager's own, unset without a running endpoint.
 */
const ENTRY_ENV: Readonly<Record<string, string>> = { KILO_DESKTOP_LLAMA_KEY: "llama-key" };

function substituteEnv(text: string): string {
	return text.replace(/\{env:([A-Z_]+)\}/gu, (_, name: string) => ENTRY_ENV[name] ?? "");
}

describe.skipIf(!kiloExecutable)("Desktop's Kilo config on the bundled kilo2", () => {
	let home: string;
	let configDirectory: string;
	let manager: KiloServerManager;

	beforeEach(async () => {
		home = await realpath(await mkdtemp(path.join(tmpdir(), "kilo2-config-")));
		const runtimeDirectory = path.join(home, "storage", "agent-v2", "runtime");
		configDirectory = path.join(runtimeDirectory, "config", "kilo2");
		manager = new KiloServerManager({
			installation: {
				executablePath: kiloExecutable!,
				treeSitterWasmDirectory: path.join(path.dirname(kiloExecutable!), "tree-sitter"),
			},
			runtimeDirectory,
			configDirectory,
			stateDirectory: path.join(home, "storage", "agent-v2"),
			corsOrigins: [],
			environment: {
				PATH: process.env.PATH,
				SystemRoot: process.env.SystemRoot,
				HOME: home,
				USERPROFILE: home,
				XDG_CONFIG_HOME: path.join(home, ".config"),
				XDG_DATA_HOME: path.join(home, "data"),
				XDG_CACHE_HOME: path.join(home, "cache"),
				KILO_DISABLE_AUTOUPDATE: "true",
				KILO_DISABLE_MODELS_FETCH: "true",
				...ENTRY_ENV,
			},
			fetch: globalThis.fetch,
			logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		});
	});

	afterEach(async () => {
		manager.dispose();
		await rm(home, { recursive: true, force: true });
	});

	it("reads every entry Desktop writes as v2 config, unchanged", async () => {
		const config = new KiloConfigManager(configDirectory);
		await reconcileWebMcpRelayConfig({ configDirectory, kiloConfig: config });
		await config.setMcpEntry("acme.tools", "acme", {
			type: "local",
			command: ["/opt/acme/bin/mcp", "--stdio"],
			environment: { ACME_HOME: "/opt/acme" },
			enabled: true,
		});
		await config.replaceProviderEntry("local-inference", "kilo-desktop-model-server", {
			npm: "@ai-sdk/openai-compatible",
			name: "Local model server",
			options: {
				baseURL: "http://127.0.0.1:43123/v1",
				headers: { Authorization: "Bearer {env:KILO_DESKTOP_LLAMA_KEY}" },
			},
			models: {
				"qwen-7b": { name: "Qwen 7B", modalities: { input: ["text"], output: ["text"] } },
			},
		});
		await config.setEntry("agent", "acme.notebook", "analyst", {
			description: "Analyses notebooks",
			prompt: "You analyse notebooks.",
			mode: "subagent",
			model: "kilo/acme/fast",
		});
		await config.setEntry("command", "acme.notebook", "analyse", {
			template: "Analyse $ARGUMENTS",
			description: "Analyse a notebook",
			agent: "analyst",
			subtask: true,
		});
		await config.setPermissionEntry("kilo.core", "suggest", "deny");
		const filePath = path.join(configDirectory, KILO_V2_CONFIG_FILENAME);
		const text = await readFile(filePath, "utf8");
		const written = parse(text) as Record<string, unknown>;

		const connection = await manager.ensureRunning();
		const client = OpenCode.make({
			baseUrl: connection.baseUrl,
			headers: {
				authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
			},
		});
		const documents = await client.config.get({ location: { directory: home } });
		const document = documents.find(
			(entry) => entry.type === "document" && entry.path === filePath,
		);

		expect(Object.keys(written).toSorted()).toEqual([
			"agents",
			"commands",
			"mcp",
			"permissions",
			"providers",
		]);
		expect(document).toMatchObject({ type: "document" });
		expect(document && "info" in document ? document.info : undefined).toEqual(
			parse(substituteEnv(text)),
		);
	});
});
