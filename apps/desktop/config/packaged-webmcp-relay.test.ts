import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolvePackagedWebMcpRelayDirectory } from "./packaged-webmcp-relay.js";

describe("resolvePackagedWebMcpRelayDirectory", () => {
	it("stages the relay beside app.asar, not inside the asar-packed app directory", () => {
		expect(resolvePackagedWebMcpRelayDirectory("/out/App-win32-x64/resources/app")).toBe(
			path.join("/out/App-win32-x64/resources", "webmcp-relay"),
		);
		expect(resolvePackagedWebMcpRelayDirectory("/out/App.app/Contents/Resources/app")).toBe(
			path.join("/out/App.app/Contents/Resources", "webmcp-relay"),
		);
	});
});
