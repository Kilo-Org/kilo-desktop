import { describe, expect, it } from "vitest";

import { parsePluginManifest, PLUGIN_MANIFEST_FILENAME, pluginManifestSchema } from "./manifest.js";

const validManifest = {
	id: "todos",
	displayName: "Todos",
	version: "1.0.0",
	main: "./src/main/index.ts",
	web: "./src/web/index.ts",
	contributes: {
		providers: [{ component: "TodosProvider", priority: 10 }],
		routes: [{ path: "/todos", component: "TodoList", title: "Todo List" }],
		nav: [{ to: "/todos", label: "Todos", icon: "list-checks" }],
		zones: [{ zone: "status-bar", component: "TodosStatusBarItem" }],
	},
};

describe("pluginManifestSchema", () => {
	it("accepts a full manifest", () => {
		const manifest = parsePluginManifest(validManifest);
		expect(manifest.id).toBe("todos");
		expect(manifest.contributes.providers).toEqual([{ component: "TodosProvider", priority: 10 }]);
		expect(manifest.contributes.routes).toEqual([
			{ path: "/todos", component: "TodoList", title: "Todo List" },
		]);
		expect(manifest.contributes.nav).toEqual([
			{ to: "/todos", label: "Todos", icon: "list-checks" },
		]);
		expect(manifest.contributes.zones).toEqual([
			{ zone: "status-bar", component: "TodosStatusBarItem" },
		]);
	});

	it("defaults contributes and its arrays to empty", () => {
		const manifest = parsePluginManifest({
			id: "headless",
			displayName: "Headless",
			version: "0.1.0",
			main: "./src/main/index.ts",
		});
		expect(manifest.contributes).toEqual({ providers: [], routes: [], nav: [], zones: [] });
	});

	it("defaults omitted contributes arrays individually", () => {
		const manifest = parsePluginManifest({
			id: "nav-only",
			displayName: "Nav Only",
			version: "1.0.0",
			web: "./src/web/index.ts",
			contributes: { nav: [{ to: "/x", label: "X" }] },
		});
		expect(manifest.contributes.routes).toEqual([]);
		expect(manifest.contributes.providers).toEqual([]);
		expect(manifest.contributes.zones).toEqual([]);
		expect(manifest.contributes.nav).toHaveLength(1);
	});

	it("accepts a renderer-only manifest (web without main)", () => {
		const manifest = parsePluginManifest({
			id: "web-only",
			displayName: "Web Only",
			version: "1.0.0",
			web: "./src/web/index.ts",
		});
		expect(manifest.main).toBeUndefined();
		expect(manifest.web).toBe("./src/web/index.ts");
	});

	it("rejects a manifest without any entry point", () => {
		const result = pluginManifestSchema.safeParse({
			id: "empty",
			displayName: "Empty",
			version: "1.0.0",
		});
		expect(result.success).toBe(false);
	});

	it.each(["Todos", "my_plugin", "-todos", "todos-", "to--dos", ""])(
		"rejects non-kebab-case id %j",
		(id) => {
			expect(pluginManifestSchema.safeParse({ ...validManifest, id }).success).toBe(false);
		},
	);

	it("accepts semver versions with pre-release and build metadata", () => {
		expect(
			pluginManifestSchema.safeParse({ ...validManifest, version: "1.2.3-beta.1+build.5" }).success,
		).toBe(true);
	});

	it.each(["1.0", "v1.0.0", "latest"])("rejects non-semver version %j", (version) => {
		expect(pluginManifestSchema.safeParse({ ...validManifest, version }).success).toBe(false);
	});

	it("rejects routes whose path does not start with '/'", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { routes: [{ path: "todos", component: "TodoList" }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects the bare '/' route path (shell-owned root)", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { routes: [{ path: "/", component: "TodoList" }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects routes without a component export name", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { routes: [{ path: "/todos", title: "Todos" }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects nav entries without a label", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { nav: [{ to: "/todos" }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects zone contributions without a component", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { zones: [{ zone: "status-bar" }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects provider contributions without a component", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { providers: [{ priority: 1 }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects providers/routes/zones on a manifest without a web entry", () => {
		const providersResult = pluginManifestSchema.safeParse({
			id: "headless",
			displayName: "Headless",
			version: "1.0.0",
			main: "./src/main/index.ts",
			contributes: { providers: [{ component: "Provider" }] },
		});
		expect(providersResult.success).toBe(false);

		const routesResult = pluginManifestSchema.safeParse({
			id: "headless",
			displayName: "Headless",
			version: "1.0.0",
			main: "./src/main/index.ts",
			contributes: { routes: [{ path: "/headless", component: "Page" }] },
		});
		expect(routesResult.success).toBe(false);

		const zonesResult = pluginManifestSchema.safeParse({
			id: "headless",
			displayName: "Headless",
			version: "1.0.0",
			main: "./src/main/index.ts",
			contributes: { zones: [{ zone: "status-bar", component: "Widget" }] },
		});
		expect(zonesResult.success).toBe(false);
	});

	it("allows nav-only contributions without a web entry", () => {
		// Nav entries are pure data (no component to resolve), so they do not
		// require a web module — a plugin may link to shell/other paths.
		const result = pluginManifestSchema.safeParse({
			id: "linker",
			displayName: "Linker",
			version: "1.0.0",
			main: "./src/main/index.ts",
			contributes: { nav: [{ to: "/todos", label: "Todos" }] },
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown manifest keys (strict)", () => {
		const result = pluginManifestSchema.safeParse({ ...validManifest, mainEntry: "typo.ts" });
		expect(result.success).toBe(false);
	});

	it("rejects unknown route keys (strict)", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { routes: [{ path: "/todos", component: "TodoList", page: "TodoList" }] },
		});
		expect(result.success).toBe(false);
	});

	it("rejects unknown contributes keys (strict)", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			contributes: { providers: [], routes: [], nav: [], zones: [], menus: [] },
		});
		expect(result.success).toBe(false);
	});

	it("parsePluginManifest throws on invalid input", () => {
		expect(() => parsePluginManifest({})).toThrow();
	});

	it("exposes the canonical manifest filename", () => {
		expect(PLUGIN_MANIFEST_FILENAME).toBe("plugin.json");
	});
});
