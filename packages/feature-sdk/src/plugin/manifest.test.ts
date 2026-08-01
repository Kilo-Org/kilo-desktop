import { describe, expect, it } from "vitest";

import { parsePluginManifest, PLUGIN_MANIFEST_FILENAME, pluginManifestSchema } from "./manifest.js";

const validManifest = {
	id: "todos",
	displayName: "Todos",
	version: "1.0.0",
	main: "./src/main/index.ts",
	web: "./src/web/index.ts",
	routes: [{ path: "/todos", label: "Todos", component: "TodoList", icon: "list-checks" }],
	zones: ["sidebar"],
};

describe("pluginManifestSchema", () => {
	it("accepts a full manifest", () => {
		const manifest = parsePluginManifest(validManifest);
		expect(manifest.id).toBe("todos");
		expect(manifest.routes).toEqual([
			{ path: "/todos", label: "Todos", component: "TodoList", icon: "list-checks" },
		]);
		expect(manifest.zones).toEqual(["sidebar"]);
	});

	it("defaults routes and zones to empty arrays", () => {
		const manifest = parsePluginManifest({
			id: "headless",
			displayName: "Headless",
			version: "0.1.0",
			main: "./src/main/index.ts",
		});
		expect(manifest.routes).toEqual([]);
		expect(manifest.zones).toEqual([]);
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
			routes: [{ path: "todos", label: "Todos", component: "TodoList" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects routes without a component export name", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			routes: [{ path: "/todos", label: "Todos" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects routes on a manifest without a web entry", () => {
		const result = pluginManifestSchema.safeParse({
			id: "headless",
			displayName: "Headless",
			version: "1.0.0",
			main: "./src/main/index.ts",
			routes: [{ path: "/headless", label: "Headless", component: "Page" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects unknown manifest keys (strict)", () => {
		const result = pluginManifestSchema.safeParse({ ...validManifest, mainEntry: "typo.ts" });
		expect(result.success).toBe(false);
	});

	it("rejects unknown route keys (strict)", () => {
		const result = pluginManifestSchema.safeParse({
			...validManifest,
			routes: [{ path: "/todos", label: "Todos", component: "TodoList", page: "TodoList" }],
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
