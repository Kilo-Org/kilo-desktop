import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));

import { ElectronApp } from "./ElectronApp.js";

describe("ElectronApp", () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("owns identity, metadata, single-instance state, and scoped listeners", () => {
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
		adapter.setIdentity();
		expect(electronApp.setName).toHaveBeenCalledWith("Anaconda Agentic Desktop");
		expect(electronApp.setAppUserModelId).toHaveBeenCalledWith("com.anaconda.agentic-desktop");

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

		adapter.setIdentity();
		expect(electronApp.setAppUserModelId).toHaveBeenCalledWith(
			"com.squirrel.AnacondaAgenticDesktop.anaconda-agentic-desktop",
		);

		adapter.quit();
		adapter.exit(2);
		adapter.relaunch({ execPath: "/bin/app" });
		expect(electronApp.quit).toHaveBeenCalledOnce();
		expect(electronApp.exit).toHaveBeenCalledWith(2);
		expect(electronApp.relaunch).toHaveBeenCalledWith({ execPath: "/bin/app" });

		adapter.relaunch();
		expect(electronApp.relaunch).toHaveBeenLastCalledWith({});
	});
});
