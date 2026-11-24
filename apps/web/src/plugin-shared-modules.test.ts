import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { HtmlTagDescriptor, IndexHtmlTransformContext } from "vite";

import { pluginSharedModules, SHARED_MODULES } from "../plugin-shared-modules";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = pluginSharedModules(root);

function call<T>(hook: unknown, ...args: unknown[]): T {
	const handler =
		typeof hook === "function"
			? hook
			: (hook as { handler: (...args: unknown[]) => unknown }).handler;
	return handler.call({}, ...args) as T;
}

function importMap(context: Partial<IndexHtmlTransformContext>): Record<string, string> {
	const [tag] = call<HtmlTagDescriptor[]>(plugin.transformIndexHtml, "", context);
	expect(tag).toMatchObject({
		tag: "script",
		attrs: { type: "importmap" },
		injectTo: "head-prepend",
	});
	return (JSON.parse(String(tag!.children)) as { imports: Record<string, string> }).imports;
}

describe("pluginSharedModules", () => {
	it("maps every shared specifier to a built module with a stable name", () => {
		const imports = importMap({});

		expect(Object.keys(imports)).toEqual(SHARED_MODULES.map((shared) => shared.specifier));
		expect(imports["react"]).toBe("/plugin-shared/react.js");
		expect(imports["@kilo-desktop/kernel/web"]).toBe("/plugin-shared/kilo-desktop__kernel__web.js");
	});

	it("points the map at the dev server's modules in development", () => {
		const imports = importMap({ server: {} as NonNullable<IndexHtmlTransformContext["server"]> });

		expect(imports["react"]).toBe("/@id/__x00__virtual:kilo-shared/react");
	});

	it("re-exports CommonJS modules by name and ES modules wholesale", () => {
		const resolved = call<string>(plugin.resolveId, "virtual:kilo-shared/react");
		const react = call<string>(plugin.load, resolved);
		const kernel = call<string>(plugin.load, "\0virtual:kilo-shared/kilo-desktop__kernel");

		expect(react).toContain('import shared from "react";');
		expect(react).toMatch(/export const \{[^}]*\buseState\b[^}]*\} = shared;/);
		expect(kernel).toBe('export * from "@kilo-desktop/kernel";\n');
		expect(call(plugin.load, "/src/main.tsx")).toBeUndefined();
	});
});

describe("the right-panel example's local plugin build", () => {
	it("keeps exactly the shared modules external", async () => {
		const { SHARED } =
			await import("../../../examples/right-panel-plugin/vite.local-plugin.config");

		expect(SHARED).toEqual(SHARED_MODULES.map((shared) => shared.specifier));
	});
});
