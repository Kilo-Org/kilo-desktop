import path from "node:path";

import { describe, expect, it } from "vitest";

import { getProductionRendererRoot, getWebDevServerUrl } from "./webDevServer.js";

describe("webDevServer", () => {
	it("reads ANACONDA_WEB_DEV_SERVER_URL", () => {
		expect(getWebDevServerUrl({ ANACONDA_WEB_DEV_SERVER_URL: "http://127.0.0.1:5173" })).toBe(
			"http://127.0.0.1:5173",
		);
		expect(getWebDevServerUrl({ ANACONDA_WEB_DEV_SERVER_URL: "  " })).toBeUndefined();
		expect(getWebDevServerUrl({})).toBeUndefined();
	});

	it("resolves the production renderer root next to the main bundle", () => {
		expect(getProductionRendererRoot("/app/.vite/build")).toBe(
			path.join("/app/.vite/build", "../renderer/main_window"),
		);
	});
});
