import { describe, expect, it } from "vitest";

import { llamaFlagsFromRows } from "./model-settings";
import {
	compactServerSettings,
	localServerSettingsSchema,
	parseServerFlagRow,
	proxyBindHost,
	renderRouterArgs,
	routerMaxModels,
	serverFlagsFromRows,
} from "./server-settings";

describe("compactServerSettings", () => {
	it("omits empty settings so defaults stay unset", () => {
		expect(compactServerSettings({})).toBeUndefined();
		expect(compactServerSettings({ modelLoadMode: "one" })).toBeUndefined();
		expect(compactServerSettings({ llamaFlags: {} })).toBeUndefined();
		expect(compactServerSettings({ serveOnLocalNetwork: false })).toBeUndefined();
		expect(
			compactServerSettings({
				port: 8080,
				modelLoadMode: "all",
				serveOnLocalNetwork: true,
				llamaFlags: { timeout: "3600" },
			}),
		).toEqual({
			port: 8080,
			modelLoadMode: "all",
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
	it("keeps one model loaded by default and only expands for all mode", () => {
		expect(routerMaxModels(5)).toBe(1);
		expect(routerMaxModels(5, "one")).toBe(1);
		expect(routerMaxModels(5, "all")).toBe(5);
	});
});

describe("renderRouterArgs", () => {
	it("starts the llama.cpp router with loopback, preset, and no autoload", () => {
		expect(
			renderRouterArgs({
				port: 43123,
				apiKeyPath: "/tmp/api-key",
				presetPath: "/tmp/models.ini",
				modelCount: 3,
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"43123",
			"--api-key-file",
			"/tmp/api-key",
			"--models-preset",
			"/tmp/models.ini",
			"--models-max",
			"1",
			"--no-models-autoload",
			"--jinja",
		]);
	});

	it("keeps the llama.cpp router on loopback when LAN serving is on", () => {
		expect(
			renderRouterArgs({
				port: 8080,
				apiKeyPath: "/tmp/api-key",
				presetPath: "/tmp/models.ini",
				modelCount: 1,
				settings: { serveOnLocalNetwork: true },
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"8080",
			"--api-key-file",
			"/tmp/api-key",
			"--models-preset",
			"/tmp/models.ini",
			"--models-max",
			"1",
			"--no-models-autoload",
			"--jinja",
		]);
	});

	it("allows expert users to keep all registered models loaded", () => {
		expect(
			renderRouterArgs({
				port: 8080,
				apiKeyPath: "/tmp/api-key",
				presetPath: "/tmp/models.ini",
				modelCount: 5,
				settings: {
					modelLoadMode: "all",
					llamaFlags: { timeout: "120", "threads-http": "8" },
				},
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"8080",
			"--api-key-file",
			"/tmp/api-key",
			"--models-preset",
			"/tmp/models.ini",
			"--models-max",
			"5",
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
			error: "Set models kept loaded in Server settings, not as a llama.cpp flag.",
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
	it("only accepts one or all as model load modes", () => {
		expect(localServerSettingsSchema.safeParse({ modelLoadMode: "one" }).success).toBe(true);
		expect(localServerSettingsSchema.safeParse({ modelLoadMode: "all" }).success).toBe(true);
		expect(localServerSettingsSchema.safeParse({ modelLoadMode: "two" }).success).toBe(false);
		expect(localServerSettingsSchema.safeParse({ maxModels: 2 }).success).toBe(false);
	});

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
