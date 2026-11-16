import { describe, expect, it } from "vitest";

import { configureLogging, resolveLogLevel } from "./logger.js";

describe("resolveLogLevel", () => {
	it("defaults to info when nothing is configured", () => {
		expect(resolveLogLevel({})).toBe("info");
	});

	it("uses the stored preference when valid", () => {
		expect(resolveLogLevel({ stored: "debug" })).toBe("debug");
	});

	it("lets the environment variable win over the stored preference", () => {
		expect(resolveLogLevel({ env: "warn", stored: "debug" })).toBe("warn");
	});

	it("ignores an invalid environment value and falls back to the stored preference", () => {
		expect(resolveLogLevel({ env: "chatty", stored: "error" })).toBe("error");
	});

	it("ignores an invalid stored value and falls back to the default", () => {
		expect(resolveLogLevel({ stored: "chatty" })).toBe("info");
	});
});

describe("configureLogging", () => {
	it("applies the level to both console and file transports", () => {
		const transports = {
			console: { level: "silly" },
			file: { level: "silly" },
		};

		configureLogging("info", transports as never);

		expect(transports.console.level).toBe("info");
		expect(transports.file.level).toBe("info");
	});
});
