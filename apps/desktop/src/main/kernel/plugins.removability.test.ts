// Principle 5 (docs/plugin-architecture.md): removing any bundled plugin
// leaves the app booting. Boots the main kernel with every bundled plugin's
// real main entry except the removed one (and plugins that `require` it),
// with a renderer kernel holding the same manifests, and checks every
// remaining plugin activates. Services are not started (that needs the
// window and spawns real processes); the browser-side half is
// apps/web/src/kernel/removability.app.test.tsx.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BUNDLED_PLUGINS, withEntries, type BundledPlugin } from "@kilo-desktop/bundled-plugins";
import { entriesWithout, pluginRemovals } from "@kilo-desktop/bundled-plugins/testing";
import { KernelError, type KernelLogger } from "@kilo-desktop/kernel";
import {
	createMemoryStorage,
	createTestKernelPair,
	type TestKernelPair,
} from "@kilo-desktop/kernel/testing";

import { createHostServices, type HostServiceDeps } from "./host-services.js";
import { bundledPluginRoot, MAIN_ENTRIES } from "./plugins.js";

const booted: { pair: TestKernelPair; dir: string }[] = [];

afterEach(async () => {
	for (const { pair, dir } of booted.splice(0)) {
		await pair.renderer.deactivate();
		await pair.main.stop();
		await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
	}
});

function memoryFs(): HostServiceDeps["fs"] {
	const files = new Map<string, string>();
	const key = (pluginId: string, file: string) => `${pluginId}:${file}`;
	return {
		readFile: async (pluginId, file) => {
			const content = files.get(key(pluginId, file));
			if (content === undefined) throw new KernelError("NOT_FOUND", `${file} does not exist.`);
			return content;
		},
		writeFile: async (pluginId, file, content) => void files.set(key(pluginId, file), content),
		exists: async (pluginId, file) => files.has(key(pluginId, file)),
		mkdir: async () => {},
		readdir: async () => [],
		remove: async (pluginId, file) => void files.delete(key(pluginId, file)),
	};
}

async function boot(plugins: readonly BundledPlugin[], removedIds: readonly string[]) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-removability-"));
	const errors: string[] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: (message) => void errors.push(message),
	};
	const deps: HostServiceDeps = {
		storageDir: (pluginId) => path.join(dir, pluginId),
		kv: (storageDir) => createMemoryStorage(storageDir).kv,
		fs: memoryFs(),
		fetch: async () => {
			throw new Error("No network in the removability test.");
		},
		protocol: { register: () => {}, unregister: () => {} },
		embeddedHosts: { register: () => () => {} },
		assets: { pluginRoot: bundledPluginRoot },
	};
	const pair = await createTestKernelPair({
		main: withEntries(entriesWithout(MAIN_ENTRIES, removedIds), plugins),
		renderer: withEntries({}, plugins),
		mainHostServices: (pluginId, manifest) => createHostServices(deps, pluginId, manifest),
		logger,
	});
	booted.push({ pair, dir });
	return { pair, errors };
}

function expectBooted({ pair, errors }: Awaited<ReturnType<typeof boot>>, expected: number) {
	const states = pair.main.pluginStates();
	expect(pair.main.issues().filter((issue) => issue.severity === "error")).toEqual([]);
	expect(errors).toEqual([]);
	expect(Object.keys(states)).toHaveLength(expected);
	expect(Object.entries(states).filter(([, state]) => state !== "active")).toEqual([]);
}

// Every plugin's real main entry per case; generous so a loaded CI worker doesn't flake.
describe("bundled plugins in main", { timeout: 30_000 }, () => {
	it("boot together", async () => {
		expectBooted(await boot(BUNDLED_PLUGINS, []), BUNDLED_PLUGINS.length);
	});

	it.each(pluginRemovals(BUNDLED_PLUGINS))(
		"boot without $removed",
		async ({ removedIds, remaining }) => {
			expectBooted(await boot(remaining, removedIds), remaining.length);
		},
	);
});
