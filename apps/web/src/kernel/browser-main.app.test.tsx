import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createLinkedTransports,
	definePlugin,
	KernelApp,
	KernelClipboard,
	KernelDataCollection,
	KernelPlugins,
	KernelQuit,
	type PluginRegistration,
	KernelNativeTheme,
	KernelNotifications,
	KernelOs,
	KernelSystem,
	SILENT_LOGGER,
} from "@kilo-desktop/kernel";

import { testManifest } from "@kilo-desktop/kernel/testing";

import { startBrowserMainKernel } from "./browser-main";

async function startKernel(
	options: { registrations?: PluginRegistration[]; reload?: () => void } = {},
) {
	return startBrowserMainKernel({
		transport: createLinkedTransports().main,
		registrations: options.registrations ?? [],
		webPlugins: [],
		logger: SILENT_LOGGER,
		...(options.reload ? { reload: options.reload } : {}),
	});
}

async function start() {
	return (await startKernel()).kernelSdk.domainObjects;
}

/** A controllable stand-in for the OS colour-scheme media query. */
function fakeSchemeQuery(initiallyDark: boolean) {
	const listeners = new Set<() => void>();
	const query = {
		matches: initiallyDark,
		addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
		removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
	};
	vi.stubGlobal("matchMedia", () => query);
	return {
		setDark(dark: boolean) {
			query.matches = dark;
			for (const listener of [...listeners]) listener();
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("browser-mode host primitives", () => {
	it("tracks the requested colour scheme", async () => {
		const domains = await start();
		const nativeTheme = domains.get(KernelNativeTheme)!;

		await nativeTheme.methods.setSource({ source: "light" });
		expect(nativeTheme.getState()).toEqual({ source: "light", shouldUseDarkColors: false });
		await nativeTheme.methods.setSource({ source: "dark" });
		expect(nativeTheme.getState().shouldUseDarkColors).toBe(true);
		await expect(
			nativeTheme.methods.setChrome({
				light: { background: "#fff", foreground: "#000" },
				dark: { background: "#000", foreground: "#fff" },
			}),
		).resolves.toBeUndefined();
	});

	it("opens external links in a new tab and uses the async clipboard", async () => {
		const domains = await start();
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

		await expect(
			domains.get(KernelOs)!.methods.openExternal({ url: "https://example.test" }),
		).resolves.toBe(false);
		await domains.get(KernelClipboard)!.methods.writeText({ text: "copied" });

		expect(open).toHaveBeenCalledWith("https://example.test", "_blank", "noopener,noreferrer");
		expect(writeText).toHaveBeenCalledWith("copied");
	});

	it("follows the OS colour scheme while set to System", async () => {
		const scheme = fakeSchemeQuery(false);
		const domains = await start();

		scheme.setDark(true);

		expect(domains.get(KernelSystem)!.getState().appearance).toBe("dark");
		expect(domains.get(KernelNativeTheme)!.getState()).toEqual({
			source: "system",
			shouldUseDarkColors: true,
		});
	});

	it("says which desktop-only shell actions are unavailable", async () => {
		const os = (await start()).get(KernelOs)!;

		await expect(os.methods.showLogs(undefined)).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await expect(os.methods.showItemInFolder({ path: "/x" })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});

	it("shows notifications once the user has allowed them", async () => {
		const shown: string[] = [];
		vi.stubGlobal(
			"Notification",
			class {
				static permission = "granted";
				constructor(title: string) {
					shown.push(title);
				}
			},
		);
		const domains = await start();

		await expect(
			domains.get(KernelNotifications)!.methods.show({ title: "Done", body: "All tests passed" }),
		).resolves.toEqual({ delivered: true });
		await domains.get(KernelNotifications)!.methods.show({ title: "Quiet" });
		await domains.get(KernelNotifications)!.methods.setBadge({ count: 2 });
		expect(shown).toEqual(["Done", "Quiet"]);
	});

	it("quits by closing the tab, relaunches by reloading, and asks before quitting when a plugin objects", async () => {
		const reload = vi.fn();
		const close = vi.spyOn(window, "close").mockImplementation(() => {});
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
		const kernel = await startKernel({
			reload,
			registrations: [
				{
					manifest: testManifest("acme.busy", {
						contributes: { extensions: { "kernel/quit": [{ id: "busy" }] } },
					}),
					entry: definePlugin({
						activate: (sdk) => {
							sdk.extensions.implement(KernelQuit, "busy", () => ({ ask: "A build is running." }));
						},
					}),
				},
			],
		});
		const app = kernel.kernelSdk.domainObjects.get(KernelApp)!;

		await app.methods.quit(undefined);
		await app.methods.relaunch({});
		await expect(kernel.requestQuit()).resolves.toBe(true);

		expect(close).toHaveBeenCalled();
		expect(reload).toHaveBeenCalled();
		expect(confirm).toHaveBeenCalledWith("A build is running.");
	});

	it("keeps the plugins turned off across reloads, and ignores an unreadable saved list", async () => {
		const plain = { manifest: testManifest("acme.plain") };
		localStorage.setItem("kernel:disabled-plugins", "{ not json");
		const first = await startKernel({ registrations: [plain] });
		const plugins = first.kernelSdk.domainObjects.get(KernelPlugins)!;
		expect(plugins.getState().disabled).toEqual([]);

		await plugins.methods.setEnabled({ pluginId: "acme.plain", enabled: false });
		const second = await startKernel({ registrations: [plain] });

		expect(second.kernelSdk.domainObjects.get(KernelPlugins)!.getState().disabled).toEqual([
			"acme.plain",
		]);
		localStorage.removeItem("kernel:disabled-plugins");
	});

	it("ignores a saved disabled list that isn't a list of plugin ids", async () => {
		localStorage.setItem("kernel:disabled-plugins", JSON.stringify({ "acme.plain": true }));
		const kernel = await startKernel({ registrations: [{ manifest: testManifest("acme.plain") }] });

		expect(kernel.kernelSdk.domainObjects.get(KernelPlugins)!.getState().disabled).toEqual([]);
		localStorage.removeItem("kernel:disabled-plugins");
	});

	it("goes back to the OS colour scheme when set to System, and stops following it once set", async () => {
		const scheme = fakeSchemeQuery(true);
		const nativeTheme = (await start()).get(KernelNativeTheme)!;

		await nativeTheme.methods.setSource({ source: "light" });
		scheme.setDark(false);
		scheme.setDark(true);
		expect(nativeTheme.getState()).toEqual({ source: "light", shouldUseDarkColors: false });

		await nativeTheme.methods.setSource({ source: "system" });
		expect(nativeTheme.getState()).toEqual({ source: "system", shouldUseDarkColors: true });
	});

	it("refuses to record a privacy choice outside the desktop app", async () => {
		const dataCollection = (await start()).get(KernelDataCollection)!;

		await expect(dataCollection.methods.setChoice({ allowed: true })).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});

	it("reports notifications as undelivered where the browser has no Notification API", async () => {
		vi.stubGlobal("Notification", undefined);
		const domains = await start();

		await expect(
			domains.get(KernelNotifications)!.methods.show({ title: "Done" }),
		).resolves.toEqual({
			delivered: false,
		});
	});

	it("reports notifications as undelivered without permission", async () => {
		const domains = await start();

		await expect(
			domains.get(KernelNotifications)!.methods.show({ title: "Done" }),
		).resolves.toEqual({
			delivered: false,
		});
	});

	it("follows the browser going offline and online", async () => {
		const domains = await start();
		const system = domains.get(KernelSystem)!;

		window.dispatchEvent(new Event("offline"));
		expect(system.getState().online).toBe(false);
		window.dispatchEvent(new Event("online"));
		expect(system.getState().online).toBe(true);
	});
});
