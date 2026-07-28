import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));

import { ElectronApp } from "./ElectronApp.js";

describe("ElectronApp", () => {
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
		};
		const adapter = new ElectronApp(electronApp as never);

		expect(adapter.metadata).toMatchObject({
			appPath: "/application",
			appVersion: "1.2.3",
			isPackaged: true,
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
});
