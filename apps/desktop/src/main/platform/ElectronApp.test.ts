import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));

import { getAppIdentity } from "$config/app-identity.js";

import { configureDevelopmentProfile, ElectronApp } from "./ElectronApp.js";

describe("ElectronApp", () => {
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
		const identity = getAppIdentity("canary");
		adapter.setIdentity(identity);
		expect(electronApp.setName).toHaveBeenCalledWith("Anaconda Agentic Desktop Canary");
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

		const identity = getAppIdentity("canary");
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

	it("isolates unpackaged development data before startup", () => {
		const makeDirectory = vi.fn();
		const electronApp = {
			isPackaged: false,
			getPath: vi.fn(() => "/profiles"),
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		configureDevelopmentProfile(electronApp as never, makeDirectory);

		const userData = path.join("/profiles", "Anaconda Agentic Desktop Dev");
		expect(electronApp.setName).toHaveBeenCalledWith("Anaconda Agentic Desktop Dev");
		expect(makeDirectory).toHaveBeenCalledWith(userData);
		expect(electronApp.setPath).toHaveBeenCalledWith("userData", userData);
	});

	it("preserves packaged application data paths", () => {
		const makeDirectory = vi.fn();
		const electronApp = {
			isPackaged: true,
			getPath: vi.fn(),
			setName: vi.fn(),
			setPath: vi.fn(),
		};

		configureDevelopmentProfile(electronApp as never, makeDirectory);

		expect(electronApp.getPath).not.toHaveBeenCalled();
		expect(electronApp.setName).not.toHaveBeenCalled();
		expect(makeDirectory).not.toHaveBeenCalled();
		expect(electronApp.setPath).not.toHaveBeenCalled();
	});
});
