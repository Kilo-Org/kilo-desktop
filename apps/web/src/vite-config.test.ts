import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config.js";

const require = createRequire(import.meta.url);

describe("renderer Vite configuration", () => {
	it("deduplicates React and the SDK React context across linked plugins", () => {
		expect(viteConfig).toMatchObject({
			resolve: {
				dedupe: expect.arrayContaining([
					"react",
					"react-dom",
					"@anaconda-agentic-desktop/sdk-react",
				]),
			},
		});
	});

	it("resolves the Files plugin directly from workspace source", () => {
		const resolvedManifest = require.resolve("@anaconda-agentic-desktop/plugin-files/plugin.json");
		const workspaceManifest = fileURLToPath(
			new URL("../../../plugins/files/plugin.json", import.meta.url),
		);

		expect(realpathSync(resolvedManifest)).toBe(realpathSync(workspaceManifest));
	});
});
