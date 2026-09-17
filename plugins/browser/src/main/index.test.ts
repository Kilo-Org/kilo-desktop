import { describe, expect, it, vi } from "vitest";

import type {
	HostBrowserController,
	HostBrowserState,
	MainSdkHostBrowser,
} from "@anaconda-agentic-desktop/feature-sdk";
import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

function createBrowserHost() {
	let emit: ((state: HostBrowserState) => void) | undefined;
	const controller = {
		webContentsId: 42,
		navigate: vi.fn(async () => undefined),
		goBack: vi.fn(),
		goForward: vi.fn(),
		reload: vi.fn(),
		hardReload: vi.fn(),
		zoomIn: vi.fn(),
		zoomOut: vi.fn(),
		resetZoom: vi.fn(),
		openDevTools: vi.fn(),
		dispose: vi.fn(),
	} satisfies HostBrowserController;
	const host = {
		partition: "persist:test-browser",
		initialize: vi.fn(),
		attach: vi.fn((_id, listener) => {
			emit = listener;
			listener({
				webContentsId: 42,
				url: "",
				title: "",
				faviconUrl: "",
				loading: false,
				canGoBack: false,
				canGoForward: false,
				zoomFactor: 1,
			});
			return controller;
		}),
	} satisfies MainSdkHostBrowser;
	return { host, controller, emit: (state: HostBrowserState) => emit?.(state) };
}

describe("browser main feature", () => {
	it("attaches, normalizes navigation, commands, and ignores stale detach", async () => {
		const browser = createBrowserHost();
		const sdk = createFakeMainSdk({
			featureId: "browser",
			host: { browser: browser.host } as never,
		});
		mainRegister(sdk);

		expect(await sdk.invoke("config")).toEqual({ partition: "persist:test-browser" });
		await sdk.invoke("attach", { instanceId: "pane-1", webContentsId: 42 });
		await sdk.invoke("navigate", { instanceId: "pane-1", url: "localhost:5173" });
		await sdk.invoke("back", { instanceId: "pane-1" });
		await sdk.invoke("detach", { instanceId: "pane-1", webContentsId: 41 });

		expect(browser.host.initialize).toHaveBeenCalledOnce();
		expect(browser.controller.navigate).toHaveBeenCalledWith("http://localhost:5173/");
		expect(browser.controller.goBack).toHaveBeenCalledOnce();
		expect(browser.controller.dispose).not.toHaveBeenCalled();
		await sdk.disposeAsync();
		expect(browser.controller.dispose).toHaveBeenCalledOnce();
	});

	it("replaces an existing attachment for the same pane", async () => {
		const browser = createBrowserHost();
		const sdk = createFakeMainSdk({
			featureId: "browser",
			host: { browser: browser.host } as never,
		});
		mainRegister(sdk);
		await sdk.invoke("attach", { instanceId: "pane-1", webContentsId: 42 });
		await sdk.invoke("attach", { instanceId: "pane-1", webContentsId: 42 });
		expect(browser.controller.dispose).toHaveBeenCalledOnce();
	});
});
