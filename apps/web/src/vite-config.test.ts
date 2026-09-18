import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config.js";

describe("renderer Vite configuration", () => {
	it("deduplicates React and the SDK React context across linked plugins", () => {
		expect(viteConfig).toMatchObject({
			resolve: {
				dedupe: expect.arrayContaining(["react", "react-dom", "@kilo-desktop/sdk-react"]),
			},
		});
	});
});
