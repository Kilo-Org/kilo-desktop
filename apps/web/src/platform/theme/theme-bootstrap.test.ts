import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { build } from "vite";

import { criticalThemeStyle } from "@kilo-desktop/contracts/theme-tokens";

describe("theme bootstrap build", () => {
	it(
		"injects critical theme CSS and bootstrap before the application module",
		{ timeout: 60_000 },
		async () => {
			const result = await build({
				configFile: fileURLToPath(new URL("../../../vite.config.ts", import.meta.url)),
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

			const criticalStyleIndex = html.source.indexOf(`<style>${criticalThemeStyle()}</style>`);
			const bootstrap = /<script>([\s\S]*?)<\/script>/.exec(html.source);
			const bootstrapIndex = bootstrap?.index ?? -1;
			const applicationIndex = html.source.indexOf('<script type="module"');

			expect(criticalStyleIndex).toBeGreaterThanOrEqual(0);
			expect(bootstrapIndex).toBeGreaterThan(criticalStyleIndex);
			expect(applicationIndex).toBeGreaterThan(bootstrapIndex);
		},
	);
});
