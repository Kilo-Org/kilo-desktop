import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));

import { getAppIdentity } from "$config/app-identity.js";

import { configureAppProfile, ElectronApp, migrateAppProfile } from "./ElectronApp.js";

describe("ElectronApp", () => {
	it("moves the original development profile into the canonical Kilo directory", () => {
		const rename = vi.fn();
		const existing = new Set([path.join("/profiles", "Anaconda Agentic Desktop Dev")]);

		expect(
			migrateAppProfile(
				"/profiles",
				"development",
				"Kilo Desktop Dev",
				(candidate) => existing.has(candidate),
				rename,
			),
		).toBe(path.join("/profiles", "Anaconda Agentic Desktop Dev"));
		expect(rename).toHaveBeenCalledWith(
			path.join("/profiles", "Anaconda Agentic Desktop Dev"),
			path.join("/profiles", "Kilo Desktop Dev"),
		);
	});

	it("never overwrites an existing canonical profile", () => {
		const rename = vi.fn();
		const existing = new Set([
			path.join("/profiles", "Kilo Desktop Dev"),
			path.join("/profiles", "Anaconda Agentic Desktop Dev"),
		]);

		expect(
			migrateAppProfile(
				"/profiles",
				"development",
				"Kilo Desktop Dev",
				(candidate) => existing.has(candidate),
				rename,
			),
		).toBeUndefined();
		expect(rename).not.toHaveBeenCalled();
	});

	const originalPlatform = process.platform;

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("owns identity, metadata, single-instance state, and scoped listeners", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const listener = vi.fn();
		const electronApp = {
			getAppPath: vi.fn(() => "/application"),
			getPath: vi.fn((name: string) => `/paths/${name}`),
			getVersion: vi.fn(() => "1.2.3"),
			isPackaged: true,
			runningUnderARM64Translation: false,
			requestSingleInstanceLock: vi.fn(() => true),
			setName: vi.fn(),
			setAppUserModelId: vi.fn(),
			on: vi.fn(),
			removeListener: vi.fn(),
			whenReady: vi.fn(async () => undefined),
			quit: vi.fn(),
			exit: vi.fn(),
			relaunch: vi.fn(),
		};
		const adapter = new ElectronApp(electronApp as never);

		expect(adapter.metadata).toMatchObject({
			appPath: "/application",
			appVersion: "1.2.3",
			isPackaged: true,
			runningUnderArm64Translation: false,
		});
		expect(adapter.getPath("userData")).toBe("/paths/userData");
		expect(adapter.requestSingleInstanceLock()).toBe(true);
		const identity = getAppIdentity("preview");
		adapter.setIdentity(identity);
		expect(electronApp.setName).toHaveBeenCalledWith("Kilo");
		expect(electronApp.setAppUserModelId).toHaveBeenCalledWith(
			process.platform === "win32" ? identity.windowsAppUserModelId : identity.appBundleId,
		);

		const dispose = adapter.on("activate", listener);
		expect(electronApp.on).toHaveBeenCalledWith("activate", listener);
		dispose();
		expect(electronApp.removeListener).toHaveBeenCalledWith("activate", listener);
	});

	it("exposes lifecycle helpers and Windows app user model id", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const electronApp = {
			getAppPath: vi.fn(() => "/application"),
			getVersion: vi.fn(() => "1.2.3"),
			isPackaged: false,
			runningUnderARM64Translation: true,
			setName: vi.fn(),
			setAppUserModelId: vi.fn(),
			whenReady: vi.fn(async () => undefined),
			quit: vi.fn(),
			exit: vi.fn(),
			relaunch: vi.fn(),
		};
		const adapter = new ElectronApp(electronApp as never);

		expect(adapter.metadata.runningUnderArm64Translation).toBe(true);
		await expect(adapter.whenReady()).resolves.toBeUndefined();
		expect(electronApp.whenReady).toHaveBeenCalledOnce();

		const identity = getAppIdentity("preview");
		adapter.setIdentity(identity);
		expect(electronApp.setName).toHaveBeenCalledWith(identity.productName);
		expect(electronApp.setAppUserModelId).toHaveBeenCalledWith(identity.windowsAppUserModelId);

		adapter.quit();
		adapter.exit(2);
		adapter.relaunch({ execPath: "/bin/app" });
		expect(electronApp.quit).toHaveBeenCalledOnce();
		expect(electronApp.exit).toHaveBeenCalledWith(2);
		expect(electronApp.relaunch).toHaveBeenCalledWith({ execPath: "/bin/app" });

		adapter.relaunch();
		expect(electronApp.relaunch).toHaveBeenLastCalledWith({});
	});

	it("registers the packaged app as the OS protocol client", () => {
		const electronApp = {
			setAsDefaultProtocolClient: vi.fn(() => true),
		};
		const adapter = new ElectronApp(electronApp as never);

		expect(adapter.setAsDefaultProtocolClient("kilo-desktop", [], "/bin/kilo", false)).toBe(true);
		expect(electronApp.setAsDefaultProtocolClient).toHaveBeenCalledWith("kilo-desktop");
	});

	it("points unpackaged protocol registration at the electron script", () => {
		const electronApp = {
			setAsDefaultProtocolClient: vi.fn(() => true),
		};
		const adapter = new ElectronApp(electronApp as never);

		expect(
			adapter.setAsDefaultProtocolClient(
				"kilo-desktop-dev",
				["electron", "apps/desktop/.vite/build/main.js"],
				"/bin/electron",
				true,
			),
		).toBe(true);
		expect(electronApp.setAsDefaultProtocolClient).toHaveBeenCalledWith(
			"kilo-desktop-dev",
			"/bin/electron",
			[path.resolve("apps/desktop/.vite/build/main.js")],
		);
	});

	it("isolates unpackaged development data before startup", () => {
		const makeDirectory = vi.fn();
		const electronApp = {
			isPackaged: false,
			getPath: vi.fn(() => "/profiles"),
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		configureAppProfile(electronApp as never, makeDirectory, "development");

		const userData = path.join("/profiles", "Kilo Desktop Dev");
		expect(electronApp.setName).toHaveBeenCalledWith("Kilo Dev");
		expect(makeDirectory).toHaveBeenCalledWith(userData);
		expect(electronApp.setPath).toHaveBeenCalledWith("userData", userData);
	});

	it.each([
		["preview", "Kilo", "Kilo Desktop"],
		["stable", "Kilo", "Kilo Desktop"],
	] as const)("configures the %s packaged data path", (environment, productName, userDataName) => {
		const makeDirectory = vi.fn();
		const electronApp = {
			isPackaged: true,
			getPath: vi.fn(() => "/profiles"),
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		configureAppProfile(electronApp as never, makeDirectory, environment);

		const userData = path.join("/profiles", userDataName);
		expect(electronApp.setName).toHaveBeenCalledWith(productName);
		expect(makeDirectory).toHaveBeenCalledWith(userData);
		expect(electronApp.setPath).toHaveBeenCalledWith("userData", userData);
	});

	it("uses the profile the shared-profile step picks and reports the former ones", () => {
		const makeDirectory = vi.fn();
		const electronApp = {
			isPackaged: true,
			getPath: vi.fn(() => "/profiles"),
			setName: vi.fn(),
			setPath: vi.fn(),
		};
		const fallback = path.join("/profiles", "Kilo Desktop Preview");

		const profile = configureAppProfile(electronApp as never, makeDirectory, "preview", [], () => ({
			userData: fallback,
			formerRoots: ["/profiles/older"],
		}));

		expect(profile).toEqual({ formerRoots: ["/profiles/older"] });
		expect(electronApp.setPath).toHaveBeenCalledWith("userData", fallback);
	});

	it("preserves an explicit user-data directory", () => {
		const makeDirectory = vi.fn();
		const electronApp = {
			isPackaged: true,
			getPath: vi.fn(() => "/profiles"),
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		configureAppProfile(electronApp as never, makeDirectory, "preview", [
			"kilo-desktop",
			"--user-data-dir=/tmp/e2e-profile",
		]);

		expect(electronApp.setName).toHaveBeenCalledWith("Kilo");
		expect(electronApp.getPath).not.toHaveBeenCalled();
		expect(makeDirectory).not.toHaveBeenCalled();
		expect(electronApp.setPath).not.toHaveBeenCalled();
	});
});
