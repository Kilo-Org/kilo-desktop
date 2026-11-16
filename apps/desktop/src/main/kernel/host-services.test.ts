import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { manifestSchema, type MainHostServices } from "@kilo-desktop/kernel";

import { createHostServices, type HostServiceDeps } from "./host-services.js";

function deps(): HostServiceDeps {
	return {
		storageDir: (pluginId) => `/data/plugins/${pluginId}`,
		kv: vi.fn(() => vi.fn()) as unknown as HostServiceDeps["kv"],
		fs: {
			readFile: vi.fn(async () => "content"),
			writeFile: vi.fn(async () => {}),
			exists: vi.fn(async () => true),
			mkdir: vi.fn(async () => {}),
			readdir: vi.fn(async () => []),
			remove: vi.fn(async () => {}),
		},
		fetch: vi.fn() as unknown as typeof fetch,
		protocol: { register: vi.fn(), unregister: vi.fn() },
		embeddedHosts: { register: vi.fn(() => () => {}) },
		browser: {
			partition: "persist:test",
			initialize: vi.fn(),
			attach: vi.fn(),
			serveLocalFiles: vi.fn(),
		},
		assets: { pluginRoot: (pluginId) => `/repo/plugins/${pluginId}` },
	};
}

const manifest = (permissions?: Record<string, unknown>) =>
	manifestSchema.parse({
		manifestVersion: 1,
		id: "acme.plugin",
		displayName: "Acme",
		version: "1.0.0",
		...(permissions ? { permissions } : {}),
	});

function servicesFor(hostDeps: HostServiceDeps, permissions?: Record<string, unknown>) {
	return createHostServices(
		hostDeps,
		"acme.plugin",
		manifest(permissions),
	) as unknown as MainHostServices;
}

describe("createHostServices", () => {
	it("scopes storage and files to the plugin", async () => {
		const hostDeps = deps();
		const services = servicesFor(hostDeps);

		await services.fs.readFile("notes/a.txt");

		expect(services.storage.dir).toBe("/data/plugins/acme.plugin");
		expect(hostDeps.fs.readFile).toHaveBeenCalledWith("acme.plugin", "notes/a.txt");
	});

	it("tells plugins when the login environment is ready, even if reading it failed", async () => {
		let settle: (value?: unknown) => void = () => {};
		const pending = new Promise((resolve) => (settle = resolve));
		const ready = vi.fn();
		servicesFor({ ...deps(), environmentReady: pending })
			.environment!.ready()
			.then(ready);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ready).not.toHaveBeenCalled();
		settle();
		await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());

		let fail: (reason: unknown) => void = () => {};
		const failing = new Promise((_resolve, reject) => (fail = reject));
		const afterFailure = servicesFor({ ...deps(), environmentReady: failing }).environment!.ready();
		fail(new Error("shell broke"));
		await expect(afterFailure).resolves.toBeUndefined();
	});

	it("leaves the environment out where the host's is complete from the start", () => {
		expect(servicesFor(deps()).environment).toBeUndefined();
	});

	it("offers protocols, embedded hosts and the browser host only when declared", () => {
		const services = servicesFor(deps());

		expect(services.protocol).toBeUndefined();
		expect(services.embeddedHosts).toBeUndefined();
		expect(services.browser).toBeUndefined();
	});

	it("only handles declared protocol schemes and embedded hosts", () => {
		const hostDeps = deps();
		const services = servicesFor(hostDeps, {
			protocols: ["acme-file"],
			embeddedHosts: ["viewer"],
			host: ["browser-host"],
		});

		services.protocol!.handle("acme-file", () => new Response());
		expect(() => services.protocol!.handle("other", () => new Response())).toThrow(
			/did not declare/,
		);
		services.embeddedHosts!.register({ host: "viewer", root: "/bundle" });
		expect(() => services.embeddedHosts!.register({ host: "sneaky", root: undefined })).toThrow(
			/did not declare/,
		);
		expect(services.browser).toMatchObject({ partition: "persist:test" });
		expect(hostDeps.protocol.register).toHaveBeenCalledOnce();
		expect(hostDeps.embeddedHosts.register).toHaveBeenCalledOnce();
	});

	it("finds a plugin's resources in its folder during development", () => {
		const services = servicesFor(deps());

		expect(services.assets?.resolve("resources/kilo")).toBe(
			path.join("/repo/plugins/acme.plugin", "resources", "kilo"),
		);
	});

	it("finds a plugin's resources among the app's packaged resources", () => {
		const services = servicesFor({
			...deps(),
			assets: { packagedResourcesPath: "/App/Resources", pluginRoot: () => undefined },
		});

		expect(services.assets?.resolve("resources/kilo")).toBe(path.join("/App/Resources", "kilo"));
		expect(() => services.assets?.resolve("src/index.ts")).toThrow(/resources\//);
	});

	it("refuses asset paths that leave the plugin's folder", () => {
		const services = servicesFor(deps());

		expect(() => services.assets?.resolve("../other/resources/x")).toThrow();
		expect(() => services.assets?.resolve("/etc/passwd")).toThrow();
	});
});
