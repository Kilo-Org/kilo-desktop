import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bundledKiloExecutable } from "../../test/agent/kilo-executable.js";
import { createInstanceDisposer } from "./dispose-instance.js";
import { KiloServerManager } from "./KiloServerManager.js";
import { createServerClient } from "./server-client.js";

const kiloExecutable = bundledKiloExecutable();

describe.skipIf(!kiloExecutable)("the bundled kilo2 server", () => {
	let home: string;
	let manager: KiloServerManager | undefined;

	beforeEach(async () => {
		home = await mkdtemp(path.join(tmpdir(), "kilo-server-manager-"));
	});

	afterEach(async () => {
		manager?.dispose();
		manager = undefined;
		await rm(home, { recursive: true, force: true });
	});

	function start(): KiloServerManager {
		const runtimeDirectory = path.join(home, "runtime");
		manager = new KiloServerManager({
			installation: {
				executablePath: kiloExecutable!,
				treeSitterWasmDirectory: path.join(path.dirname(kiloExecutable!), "tree-sitter"),
			},
			runtimeDirectory,
			configDirectory: path.join(runtimeDirectory, "config", "kilo2"),
			managedPluginDirectory: path.join(runtimeDirectory, "kilo-plugins"),
			stateDirectory: path.join(home, "state"),
			corsOrigins: ["kilo-desktop://app"],
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
			fetch,
			logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
		});
		return manager;
	}

	it("starts, answers with its credentials, releases a location, and stops when told", async () => {
		const server = start();
		const project = path.join(home, "project");
		await mkdir(project);

		const connection = await server.ensureRunning();
		const client = createServerClient(connection);
		const info = await client.server.info();
		await createInstanceDisposer()(connection, project);
		await server.stop();

		expect(connection).toMatchObject({ username: "opencode", version: info.version });
		expect(info.version).toMatch(/\S/);
		expect(server.status).toEqual({ status: "stopped" });
		await expect(fetch(`${connection.baseUrl}/api/info`)).rejects.toThrow();
	});

	it("restarts on the same address with the same credentials", async () => {
		const server = start();

		const first = await server.ensureRunning();
		const second = await server.restart();

		expect(second).toMatchObject({ baseUrl: first.baseUrl, password: first.password });
		await expect(createServerClient(second).server.info()).resolves.toMatchObject({
			version: first.version,
		});
	});
});
