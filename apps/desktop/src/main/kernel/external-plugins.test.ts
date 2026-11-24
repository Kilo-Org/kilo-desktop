import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KvStore } from "@kilo-desktop/kernel";

import {
	ExternalPlugins,
	externalPluginUrl,
	localPluginsFlagAtLaunch,
	type ExternalPluginsOptions,
	type ExternalPluginsSettings,
} from "./external-plugins.js";

let directory: string;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-external-plugins-")));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function memoryStore(
	initial: Partial<ExternalPluginsSettings> = {},
): KvStore<ExternalPluginsSettings> {
	let value: ExternalPluginsSettings = {
		enabled: false,
		approvals: {},
		featureAvailable: true,
		...initial,
	};
	return {
		snapshot: () => ({ ...value }),
		get: (key) => value[key],
		set: (patch) => {
			value = { ...value, ...patch };
			return { ...value };
		},
		clear: () => {
			value = { enabled: false, approvals: {}, featureAvailable: false };
		},
	};
}

const silent = { warn: () => {}, error: () => {} };

function manifest(id: string, overrides: Record<string, unknown> = {}) {
	return {
		manifestVersion: 1,
		id,
		displayName: `Plugin ${id}`,
		version: "0.1.0",
		engines: { "kilo-desktop": "^1.0" },
		main: "./main.js",
		...overrides,
	};
}

async function writePlugin(
	folder: string,
	pluginManifest: unknown,
	files: Record<string, string> = { "main.js": "export default { activate() {} };" },
): Promise<string> {
	const root = path.join(directory, folder);
	await mkdir(root, { recursive: true });
	await writeFile(path.join(root, "plugin.json"), JSON.stringify(pluginManifest));
	for (const [file, content] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(root, file)), { recursive: true });
		await writeFile(path.join(root, file), content);
	}
	return root;
}

function create(overrides: Partial<ExternalPluginsOptions> = {}) {
	return new ExternalPlugins({
		directory,
		store: memoryStore(),
		reservedIds: new Set(["kilo.shell"]),
		apiVersion: "1.0.0",
		confirmApproval: vi.fn(async () => true),
		logger: silent,
		...overrides,
	});
}

/** Its state, which is null only while the feature is unavailable. */
function stateOf(plugins: ExternalPlugins) {
	const state = plugins.state();
	if (!state) throw new Error("Local plugins are unavailable.");
	return state;
}

/** Scans, then approves every ready plugin as the user would. */
async function approveAll(plugins: ExternalPlugins): Promise<void> {
	await plugins.refresh();
	for (const record of stateOf(plugins).plugins) {
		if (record.status === "ready") await plugins.approve(record.id!, record.hash!);
	}
}

describe("ExternalPlugins — scanning", () => {
	it("lists nothing and reads nothing at launch while local plugins are off", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const plugins = create();

		await plugins.load();

		expect(plugins.state()).toEqual({
			enabled: false,
			directory,
			plugins: [],
			restartNeeded: false,
		});
		expect(plugins.registrations()).toEqual([]);
	});

	it("lists each folder's plugin, unapproved, with a digest of its files", async () => {
		await writePlugin("hello", manifest("acme.hello", { description: "Says hello." }));
		const plugins = create();

		await plugins.refresh();

		expect(stateOf(plugins).plugins).toEqual([
			{
				folder: "hello",
				id: "acme.hello",
				displayName: "Plugin acme.hello",
				version: "0.1.0",
				description: "Says hello.",
				hash: expect.stringMatching(/^[0-9a-f]{64}$/),
				status: "ready",
				approved: false,
				loaded: false,
			},
		]);
	});

	it("accepts the example local plugin", async () => {
		const example = path.resolve(import.meta.dirname, "../../../../../examples/local-plugin");
		await symlink(example, path.join(directory, "local-plugin"));
		const plugins = create();

		await plugins.refresh();

		expect(stateOf(plugins).plugins).toEqual([
			expect.objectContaining({ id: "example.local-hello", status: "ready" }),
		]);
	});

	it("rejects the right-panel example's source folder, which must be built first", async () => {
		const example = path.resolve(import.meta.dirname, "../../../../../examples/right-panel-plugin");
		await symlink(example, path.join(directory, "right-panel-plugin"));
		const plugins = create();

		await plugins.refresh();

		expect(stateOf(plugins).plugins).toEqual([
			expect.objectContaining({
				id: "example.right-panel",
				status: "invalid",
				message: expect.stringMatching(/isn't JavaScript/),
			}),
		]);
	});

	it("hints that a node_modules folder isn't loaded, without rejecting the plugin", async () => {
		await writePlugin("deps", manifest("acme.deps"), {
			"main.js": "export default { activate() {} };",
			"node_modules/left-pad/index.js": "export default 1;",
		});
		await writePlugin("plain", manifest("acme.plain"));
		const plugins = create();

		await plugins.refresh();

		expect(stateOf(plugins).plugins).toEqual([
			expect.objectContaining({
				id: "acme.deps",
				status: "ready",
				hint: expect.stringMatching(/node_modules.*bundle/i),
			}),
			expect.not.objectContaining({ hint: expect.anything() }),
		]);
	});

	it("treats a missing directory as empty", async () => {
		const plugins = create({ directory: path.join(directory, "missing") });

		await plugins.refresh();

		expect(stateOf(plugins).plugins).toEqual([]);
	});

	it.each([
		["no manifest", undefined, /No plugin\.json/],
		["an invalid manifest", { manifestVersion: 1, id: "nope" }, /Invalid plugin\.json/],
		["the reserved publisher", manifest("kilo.sneaky"), /reserved/],
		["a bundled plugin's id", manifest("kilo.shell"), /reserved/],
		["no engines", manifest("acme.old", { engines: undefined }), /engines/],
		[
			"an unsupported engine",
			manifest("acme.future", { engines: { "kilo-desktop": "^2.0" } }),
			/\^2\.0.*1\.0\.0/,
		],
		["no entry", manifest("acme.empty", { main: undefined }), /neither a main nor a web entry/],
		["a missing entry", manifest("acme.lost", { main: "./dist/main.js" }), /dist\/main\.js/],
		["an entry outside its folder", manifest("acme.escape", { main: "../main.js" }), /outside/],
		[
			"a TypeScript source entry",
			manifest("acme.source", { main: undefined, web: "./src/web/index.tsx" }),
			/isn.t JavaScript/,
		],
		[
			"a URL scheme",
			manifest("acme.scheme", { permissions: { protocols: ["acme"] } }),
			/URL schemes/,
		],
		[
			"a withheld host permission",
			manifest("acme.keys", { permissions: { host: ["keychain"] } }),
			/keychain/,
		],
	])("rejects a plugin with %s", async (_case, pluginManifest, message) => {
		if (pluginManifest === undefined) {
			await mkdir(path.join(directory, "broken"), { recursive: true });
		} else {
			await writePlugin("broken", pluginManifest);
		}
		const plugins = create();

		await plugins.refresh();

		expect(stateOf(plugins).plugins).toEqual([
			expect.objectContaining({
				folder: "broken",
				status: "invalid",
				message: expect.stringMatching(message),
				approved: false,
			}),
		]);
	});

	it("rejects every folder that claims the same id", async () => {
		await writePlugin("one", manifest("acme.twin"));
		await writePlugin("two", manifest("acme.twin"));
		const plugins = create();

		await plugins.refresh();

		expect(stateOf(plugins).plugins.map(({ folder, status }) => [folder, status])).toEqual([
			["one", "invalid"],
			["two", "invalid"],
		]);
	});

	it("follows a linked plugin folder and skips dot entries and node_modules", async () => {
		const project = await mkdtemp(path.join(os.tmpdir(), "kilo-linked-plugin-"));
		try {
			await writeFile(path.join(project, "plugin.json"), JSON.stringify(manifest("acme.linked")));
			await writeFile(path.join(project, "main.js"), "export default { activate() {} };");
			await symlink(project, path.join(directory, "linked"));
			const plugins = create();
			await plugins.refresh();
			const before = stateOf(plugins).plugins[0]?.hash;

			await mkdir(path.join(project, ".git"));
			await writeFile(path.join(project, ".git", "HEAD"), "ref: main");
			await mkdir(path.join(project, "node_modules"));
			await writeFile(path.join(project, "node_modules", "x.js"), "");
			await plugins.refresh();

			expect(stateOf(plugins).plugins[0]).toMatchObject({ id: "acme.linked", status: "ready" });
			expect(stateOf(plugins).plugins[0]?.hash).toBe(before);
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	});
});

describe("ExternalPlugins — approval", () => {
	it("asks the user before approving, and approves nothing they decline", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const confirmApproval = vi.fn(async () => false);
		const plugins = create({ confirmApproval });
		await plugins.refresh();
		const { hash } = stateOf(plugins).plugins[0]!;

		await expect(plugins.approve("acme.hello", hash!)).resolves.toBe(false);

		expect(confirmApproval).toHaveBeenCalledWith(
			expect.objectContaining({ id: "acme.hello", folder: path.join(directory, "hello") }),
		);
		expect(stateOf(plugins).plugins[0]?.approved).toBe(false);
	});

	it("pins approval to the files: a change asks again", async () => {
		const root = await writePlugin("hello", manifest("acme.hello"));
		const store = memoryStore({ enabled: true });
		const plugins = create({ store });
		await approveAll(plugins);
		expect(stateOf(plugins).plugins[0]?.approved).toBe(true);

		await writeFile(path.join(root, "main.js"), "export default { activate() { /* changed */ } };");
		await plugins.refresh();

		expect(stateOf(plugins).plugins[0]).toMatchObject({ approved: false, status: "ready" });
	});

	it("refuses to approve files that changed since the user saw them", async () => {
		const root = await writePlugin("hello", manifest("acme.hello"));
		const plugins = create();
		await plugins.refresh();
		const { hash } = stateOf(plugins).plugins[0]!;
		await writeFile(path.join(root, "main.js"), "export default { activate() { /* changed */ } };");
		await plugins.refresh();

		await expect(plugins.approve("acme.hello", hash!)).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("refuses to approve an invalid plugin", async () => {
		await writePlugin("broken", manifest("acme.broken", { main: "./gone.js" }));
		const plugins = create();
		await plugins.refresh();

		await expect(plugins.approve("acme.broken", "whatever")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("revokes an approval", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const plugins = create();
		await approveAll(plugins);

		plugins.revoke("acme.hello");

		expect(stateOf(plugins).plugins[0]?.approved).toBe(false);
	});

	it("creates the plugins folder at launch, even while local plugins are off", async () => {
		const folder = path.join(directory, "not-yet");

		await create({ directory: folder }).load();

		expect((await stat(folder)).isDirectory()).toBe(true);
	});

	it("notifies listeners of every change", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const plugins = create();
		const listener = vi.fn();
		plugins.onChange(listener);

		await plugins.refresh();
		plugins.setEnabled(true);

		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("ExternalPlugins — loading at launch", () => {
	it("loads approved plugins' contracts and main entry as external registrations", async () => {
		await writePlugin(
			"hello",
			manifest("acme.hello", { contracts: "./contracts.js", web: "./web.js" }),
			{
				"main.js": "export default { activate() {} };",
				"contracts.js": "export const definitions = { domainObjects: [] };",
				"web.js": "export default { activate() {} };",
			},
		);
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });

		await plugins.load();

		const [registration] = plugins.registrations();
		expect(registration).toMatchObject({
			manifest: { id: "acme.hello" },
			definitions: { domainObjects: [] },
			source: "external",
			entry: { activate: expect.any(Function) },
		});
		expect(plugins.webPluginIds()).toEqual(["acme.hello"]);
		expect(plugins.state()).toMatchObject({
			restartNeeded: false,
			plugins: [{ id: "acme.hello", approved: true, loaded: true }],
		});
	});

	it("skips unapproved plugins and says a restart would load newly approved ones", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const plugins = create({ store: memoryStore({ enabled: true }) });
		await plugins.load();
		expect(plugins.registrations()).toEqual([]);

		await approveAll(plugins);

		expect(plugins.state()).toMatchObject({
			restartNeeded: true,
			plugins: [{ approved: true, loaded: false }],
		});
	});

	it("marks a plugin whose code fails to load as failed and keeps going", async () => {
		await writePlugin("bad", manifest("acme.bad"), { "main.js": "throw new Error('boom');" });
		await writePlugin("good", manifest("acme.good"));
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });

		await plugins.load();

		expect(plugins.registrations().map((registration) => registration.source)).toEqual([
			"external",
		]);
		expect(stateOf(plugins).plugins).toEqual([
			expect.objectContaining({
				id: "acme.bad",
				status: "failed",
				message: expect.stringMatching(/boom/),
			}),
			expect.objectContaining({ id: "acme.good", loaded: true }),
		]);
		expect(stateOf(plugins).restartNeeded).toBe(false);
	});

	it("judges a rebuilt plugin afresh after its old files failed to load", async () => {
		const root = await writePlugin("bad", manifest("acme.bad"), {
			"main.js": "throw new Error('boom');",
		});
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });
		await plugins.load();

		await writeFile(path.join(root, "main.js"), "export default { activate() {} };");
		await plugins.refresh();
		const [rebuilt] = stateOf(plugins).plugins;
		await plugins.approve("acme.bad", rebuilt!.hash!);

		expect(plugins.state()).toMatchObject({
			restartNeeded: true,
			plugins: [{ status: "ready", approved: true, loaded: false }],
		});
		expect(stateOf(plugins).plugins[0]?.message).toBeUndefined();
	});

	it("rejects a main entry that is not a plugin entry", async () => {
		await writePlugin("odd", manifest("acme.odd"), { "main.js": "export default 42;" });
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });

		await plugins.load();

		expect(stateOf(plugins).plugins[0]).toMatchObject({
			status: "failed",
			message: expect.stringMatching(/activate/),
		});
	});

	it("imports each module once per digest, from the folder", async () => {
		const root = await writePlugin("hello", manifest("acme.hello"));
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const importModule = vi.fn(async () => ({ default: { activate() {} } }));
		const plugins = create({ store, importModule });

		await plugins.load();

		const [url] = importModule.mock.calls[0] as unknown as [string];
		expect(url.startsWith(pathToFileURL(path.join(root, "main.js")).href)).toBe(true);
		expect(url).toMatch(/\?v=[0-9a-f]+$/);
	});

	it("turning local plugins off unloads them from the next launch", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });
		await plugins.load();

		plugins.setEnabled(false);

		expect(plugins.state()).toMatchObject({ enabled: false, restartNeeded: true });
		expect(store.get("enabled")).toBe(false);
	});
});

describe("ExternalPlugins — feature flag", () => {
	it("is unavailable, loads nothing and creates no folder while the feature is off", async () => {
		const folder = path.join(directory, "not-yet");
		await writePlugin("hello", manifest("acme.hello"));
		const plugins = create({
			directory: folder,
			store: memoryStore({ enabled: true, featureAvailable: false }),
		});

		await plugins.load();

		expect(plugins.state()).toBeNull();
		expect(plugins.registrations()).toEqual([]);
		await expect(stat(folder)).rejects.toThrow();
		expect(() => plugins.setEnabled(true)).toThrow(/not available/);
		await expect(plugins.refresh()).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});

	it("lets a flag value known at launch decide, ahead of what was last remembered", () => {
		expect(
			create({ store: memoryStore({ featureAvailable: false }), featureAtLaunch: true }).state(),
		).not.toBeNull();
		expect(
			create({ store: memoryStore({ featureAvailable: true }), featureAtLaunch: false }).state(),
		).toBeNull();
	});

	it.each([
		[
			"the build's override",
			{ override: false, flagSourceConfigured: true, declaredDefault: true },
			false,
		],
		[
			"the declared default without a flag source",
			{ override: undefined, flagSourceConfigured: false, declaredDefault: false },
			false,
		],
		[
			"nothing, when only the flag source can say",
			{ override: undefined, flagSourceConfigured: true, declaredDefault: false },
			undefined,
		],
	])("knows the flag at launch from %s", (_case, input, expected) => {
		expect(localPluginsFlagAtLaunch(input)).toBe(expected);
	});

	it("remembers the flag for the next launch, and says a restart applies it", async () => {
		await writePlugin("hello", manifest("acme.hello"));
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });
		await plugins.load();
		const listener = vi.fn();
		plugins.onChange(listener);

		plugins.setFeatureAvailable(false);

		expect(store.get("featureAvailable")).toBe(false);
		expect(plugins.state()).toBeNull();
		expect(listener).toHaveBeenCalled();
		expect(create({ store }).state()).toBeNull();
	});
});

describe("ExternalPlugins — windows", () => {
	async function loadedWebPlugin() {
		await writePlugin(
			"hello",
			manifest("acme.hello", {
				main: undefined,
				web: "./dist/web.js",
				contracts: "./dist/contracts.js",
			}),
			{
				"dist/web.js": "export default { activate() {} };",
				"dist/contracts.js": "export const definitions = {};",
				"dist/chunk.js": "export const x = 1;",
			},
		);
		const store = memoryStore({ enabled: true });
		await approveAll(create({ store }));
		const plugins = create({ store });
		await plugins.load();
		return plugins;
	}

	it("describes loaded plugins to windows with app-origin URLs for their modules", async () => {
		const plugins = await loadedWebPlugin();

		expect(plugins.windowPlugins()).toEqual([
			{
				manifest: expect.objectContaining({ id: "acme.hello" }),
				contracts: expect.stringMatching(
					/^\/external-plugins\/acme\.hello\/dist\/contracts\.js\?v=/,
				),
				web: expect.stringMatching(/^\/external-plugins\/acme\.hello\/dist\/web\.js\?v=/),
			},
		]);
	});

	it("serves the approved bytes of a loaded plugin's files, and nothing else", async () => {
		const plugins = await loadedWebPlugin();

		expect(
			new TextDecoder().decode(plugins.file("/external-plugins/acme.hello/dist/chunk.js")?.body),
		).toBe("export const x = 1;");
		expect(plugins.file("/external-plugins/acme.hello/plugin.json")).toBeDefined();
		expect(plugins.file("/external-plugins/acme.hello/../acme.other/x.js")).toBeUndefined();
		expect(plugins.file("/external-plugins/acme.hello/missing.js")).toBeUndefined();
		expect(plugins.file("/external-plugins/acme.other/dist/web.js")).toBeUndefined();
		expect(plugins.file("/assets/index.js")).toBeUndefined();
	});

	it("builds file URLs from a plugin id and path", () => {
		expect(externalPluginUrl("acme.hello", "./dist/web.js", "abcdef0123456789")).toBe(
			"/external-plugins/acme.hello/dist/web.js?v=abcdef012345",
		);
	});
});
