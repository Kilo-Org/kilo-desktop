import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ServerConnection } from "../contracts";
import { getKiloCliArtifact } from "../main/agent/cli-distribution/artifacts.js";
import { KiloServerManager } from "../main/agent/KiloServerManager.js";

/** The kilo2 binary installed for this platform, if any (integration tests skip without it). */
export function bundledKiloExecutable(): string | undefined {
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

export interface RealKilo2 {
	readonly connection: ServerConnection;
	/** Desktop's Kilo config directory (`KILO2_CONFIG_DIR`), v2's global config. */
	readonly configDirectory: string;
	stop(): Promise<void>;
}

/**
 * Desktop's own kilo2 server on the bundled binary, in a throwaway home with
 * no network catalog, as kilo.core starts it (`KiloServerManager`).
 */
export async function startRealKilo2(
	executable: string,
	environment: Readonly<Record<string, string | undefined>> = {},
): Promise<RealKilo2> {
	const home = await realpath(await mkdtemp(path.join(tmpdir(), "kilo2-")));
	const runtimeDirectory = path.join(home, "storage", "agent-v2", "runtime");
	const configDirectory = path.join(runtimeDirectory, "config", "kilo2");
	const manager = new KiloServerManager({
		installation: {
			executablePath: executable,
			treeSitterWasmDirectory: path.join(path.dirname(executable), "tree-sitter"),
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
			...environment,
		},
		fetch: globalThis.fetch,
		logger: { info() {}, warn() {}, error() {} },
	});
	const connection = await manager.ensureRunning();
	return {
		connection: { ...connection, globalDirectory: home },
		configDirectory,
		async stop() {
			manager.dispose();
			await rm(home, { recursive: true, force: true });
		},
	};
}
