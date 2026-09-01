import { describe, expect, it } from "vitest";

import { llamaFlagsFromRows } from "./model-settings.js";
import {
	compactServerSettings,
	localServerSettingsSchema,
	parseServerFlagRow,
	proxyBindHost,
	renderRouterArgs,
	routerMaxModels,
	serverFlagsFromRows,
} from "./server-settings.js";

describe("compactServerSettings", () => {
	it("omits empty settings so defaults stay unset", () => {
		expect(compactServerSettings({})).toBeUndefined();
		expect(compactServerSettings({ llamaFlags: {} })).toBeUndefined();
		expect(compactServerSettings({ serveOnLocalNetwork: false })).toBeUndefined();
		expect(
			compactServerSettings({
				port: 8080,
				maxModels: 2,
				serveOnLocalNetwork: true,
				llamaFlags: { timeout: "3600" },
			}),
		).toEqual({
			port: 8080,
			maxModels: 2,
			serveOnLocalNetwork: true,
			llamaFlags: { timeout: "3600" },
		});
	});
});

describe("proxyBindHost", () => {
	it("binds loopback by default and all interfaces when serving on the LAN", () => {
		expect(proxyBindHost()).toBe("127.0.0.1");
		expect(proxyBindHost(false)).toBe("127.0.0.1");
		expect(proxyBindHost(true)).toBe("0.0.0.0");
	});
});

describe("routerMaxModels", () => {
	it("uses the configured cap when set, otherwise every registered model", () => {
		expect(routerMaxModels(5)).toBe(5);
		expect(routerMaxModels(5, 2)).toBe(2);
		expect(routerMaxModels(2, 8)).toBe(8);
	});
});

describe("renderRouterArgs", () => {
	it("starts the llama.cpp router with loopback, preset, and no autoload", () => {
		expect(
			renderRouterArgs({
				port: 43123,
				apiKey: "secret",
				presetPath: "/tmp/models.ini",
				modelCount: 3,
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"43123",
			"--api-key",
			"secret",
			"--models-preset",
			"/tmp/models.ini",
			"--models-max",
			"3",
			"--no-models-autoload",
			"--jinja",
		]);
	});

	it("keeps the llama.cpp router on loopback when LAN serving is on", () => {
		expect(
			renderRouterArgs({
				port: 8080,
				apiKey: "secret",
				presetPath: "/tmp/models.ini",
				modelCount: 1,
				settings: { serveOnLocalNetwork: true },
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"8080",
			"--api-key",
			"secret",
			"--models-preset",
			"/tmp/models.ini",
			"--models-max",
			"1",
			"--no-models-autoload",
			"--jinja",
		]);
	});

	it("applies max models and extra llama.cpp router flags", () => {
		expect(
			renderRouterArgs({
				port: 8080,
				apiKey: "secret",
				presetPath: "/tmp/models.ini",
				modelCount: 5,
				settings: {
					maxModels: 2,
					llamaFlags: { timeout: "120", "threads-http": "8" },
				},
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"8080",
			"--api-key",
			"secret",
			"--models-preset",
			"/tmp/models.ini",
			"--models-max",
			"2",
			"--no-models-autoload",
			"--jinja",
			"--threads-http",
			"8",
			"--timeout",
			"120",
		]);
	});
});

describe("server llama.cpp flags", () => {
	it("rejects first-class and router-owned flags in the advanced list", () => {
		expect(llamaFlagsFromRows([{ key: "port", value: "8080" }])).toEqual({
			ok: false,
			error: "Set port in Server settings, not as a llama.cpp flag.",
		});
		expect(llamaFlagsFromRows([{ key: "models-max", value: "2" }])).toEqual({
			ok: false,
			error: "Set max models in Server settings, not as a llama.cpp flag.",
		});
		expect(serverFlagsFromRows([{ key: "jinja", value: "off" }])).toEqual({
			ok: false,
			error: 'Cannot override reserved llama.cpp flag "jinja".',
		});
		expect(parseServerFlagRow("jinja", "off")).toEqual({
			ok: false,
			error: 'Cannot override reserved llama.cpp flag "jinja".',
		});
		expect(parseServerFlagRow("timeout", "120")).toEqual({
			ok: true,
			key: "timeout",
			value: "120",
		});
		expect(serverFlagsFromRows([{ key: "timeout", value: "120" }])).toEqual({
			ok: true,
			flags: { timeout: "120" },
		});
		expect(serverFlagsFromRows([{ key: "no-models-autoload", value: "on" }])).toEqual({
			ok: false,
			error: 'Cannot override reserved llama.cpp flag "no-models-autoload".',
		});
	});
});

describe("localServerSettingsSchema", () => {
	it("rejects reserved llama.cpp flags stored on the server", () => {
		expect(localServerSettingsSchema.safeParse({ llamaFlags: { jinja: "off" } }).success).toBe(
			false,
		);
		expect(localServerSettingsSchema.safeParse({ llamaFlags: { timeout: "120" } }).success).toBe(
			true,
		);
		expect(localServerSettingsSchema.safeParse({}).success).toBe(true);
	});
});
