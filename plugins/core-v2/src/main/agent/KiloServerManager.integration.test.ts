import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KiloServerConnection } from "./types.js";

import { getKiloCliArtifact, KILO_CLI_VERSION } from "./cli-distribution/artifacts.js";
import { KiloServerManager } from "./KiloServerManager.js";

const RENDERER_ORIGIN = "kilo-desktop://app";

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

function authorization(connection: KiloServerConnection): string {
	return `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`;
}

interface ConfigDocument {
	readonly type: string;
	readonly path?: string;
	readonly info?: { readonly permissions?: readonly unknown[] };
}

describe.skipIf(!kiloExecutable)("Desktop's own server on the bundled kilo2", () => {
	let home: string;
	let project: string;
	let manager: KiloServerManager;

	beforeEach(async () => {
		// The server reports real paths (macOS's /var is /private/var).
		home = await realpath(await mkdtemp(path.join(tmpdir(), "kilo2-server-")));
		project = path.join(home, "project");
		await mkdir(project);
		const runtimeDirectory = path.join(home, "storage", "agent-v2", "runtime");
		manager = new KiloServerManager({
			installation: {
				executablePath: kiloExecutable!,
				treeSitterWasmDirectory: path.join(path.dirname(kiloExecutable!), "tree-sitter"),
			},
			runtimeDirectory,
			configDirectory: path.join(runtimeDirectory, "config", "kilo2"),
			stateDirectory: path.join(home, "storage", "agent-v2"),
			corsOrigins: [RENDERER_ORIGIN],
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
			},
			fetch: globalThis.fetch,
			logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		});
	});

	afterEach(async () => {
		manager.dispose();
		await rm(home, { recursive: true, force: true });
	});

	it("starts with --stdio, answers as the pinned version and stops when its stdin closes", async () => {
		const connection = await manager.ensureRunning();

		expect(connection).toMatchObject({ username: "opencode", version: KILO_CLI_VERSION });
		const info = await fetch(`${connection.baseUrl}/api/info`, {
			headers: { authorization: authorization(connection) },
		});
		expect(info.status).toBe(200);

		await manager.stop();
		await expect(fetch(`${connection.baseUrl}/api/info`)).rejects.toThrow();
	});

	it("lets the app's renderer origin call it and refuses other cross-site origins", async () => {
		const connection = await manager.ensureRunning();
		const crossSite = (origin: string) =>
			fetch(`${connection.baseUrl}/api/info`, {
				headers: {
					authorization: authorization(connection),
					origin,
					"sec-fetch-site": "cross-site",
					"sec-fetch-mode": "cors",
				},
			});

		const renderer = await crossSite(RENDERER_ORIGIN);
		expect(renderer.status).toBe(200);
		expect(renderer.headers.get("access-control-allow-origin")).toBe(RENDERER_ORIGIN);
		expect((await crossSite("https://example.com")).status).toBe(403);
	});

	it("reads Desktop's inline config as v2 shell rules", async () => {
		const connection = await manager.ensureRunning();
		const response = await fetch(
			`${connection.baseUrl}/api/config?location[directory]=${encodeURIComponent(project)}`,
			{ headers: { authorization: authorization(connection) } },
		);
		const documents = (await response.json()) as ConfigDocument[];

		expect(documents.flatMap((document) => document.info?.permissions ?? [])).toContainEqual({
			action: "shell",
			resource: "tar *",
			effect: "ask",
		});
	});
});
