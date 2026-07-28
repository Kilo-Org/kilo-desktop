import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveMigrationsFolder } from "./client.js";

describe("resolveMigrationsFolder", () => {
	it("walks up from the built main directory to the package-local drizzle folder", () => {
		expect(resolveMigrationsFolder("/app/.vite/build")).toBe(path.join("/app", "drizzle"));
	});

	it("works when the package root is nested under asar as app/", () => {
		expect(resolveMigrationsFolder("/Resources/app.asar/app/.vite/build")).toBe(
			path.join("/Resources/app.asar/app", "drizzle"),
		);
	});

	it("resolves the real package drizzle folder from this source file's sibling layout", () => {
		const fromBuiltMainShape = path.resolve(import.meta.dirname, "../../../.vite/build");
		expect(resolveMigrationsFolder(fromBuiltMainShape)).toBe(
			path.resolve(import.meta.dirname, "../../../drizzle"),
		);
	});
});
