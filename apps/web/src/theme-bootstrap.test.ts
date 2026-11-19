import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

import { criticalThemeStyle } from "@kilo-desktop/ui/themes/theme-tokens";

/**
 * The page is built through apps/web's real Vite config with a tiny entry, so
 * the test covers the config's HTML pipeline without bundling the app.
 */
describe("theme bootstrap build", () => {
	let root = "";
	let indexHtml = "";

	beforeAll(async () => {
		root = await mkdtemp(path.join(tmpdir(), "theme-bootstrap-"));
		await writeFile(
			path.join(root, "index.html"),
			[
				"<!doctype html>",
				'<html lang="en">',
				"<head>",
				'<meta charset="UTF-8" />',
				"</head>",
				"<body>",
				'<div id="root"></div>',
				'<script type="module" src="/entry.js"></script>',
				"</body>",
				"</html>",
				"",
			].join("\n"),
		);
		await writeFile(path.join(root, "entry.js"), "export {};\n");

		const result = await build({
			configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
			root,
			logLevel: "silent",
			build: { write: false },
		});
		const outputs = Array.isArray(result) ? result : [result];
		const html = outputs
			.flatMap((output) => ("output" in output ? output.output : []))
			.find((output) => output.type === "asset" && output.fileName === "index.html");

		if (!html || html.type !== "asset" || typeof html.source !== "string") {
			throw new Error("Expected the Vite build to emit index.html.");
		}
		indexHtml = html.source;
	});

	afterAll(async () => {
		if (root) await rm(root, { recursive: true, force: true });
	});

	it("injects critical theme CSS and bootstrap before the application module", () => {
		const criticalStyleIndex = indexHtml.indexOf(`<style>${criticalThemeStyle()}</style>`);
		const bootstrap = /<script>([\s\S]*?)<\/script>/.exec(indexHtml);
		const bootstrapIndex = bootstrap?.index ?? -1;
		const applicationIndex = indexHtml.indexOf('<script type="module"');

		expect(criticalStyleIndex).toBeGreaterThanOrEqual(0);
		expect(bootstrapIndex).toBeGreaterThan(criticalStyleIndex);
		expect(applicationIndex).toBeGreaterThan(bootstrapIndex);
	});
});
