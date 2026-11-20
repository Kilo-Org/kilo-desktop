import { afterEach, describe, expect, it, vi } from "vitest";

import {
	KernelDataCollection,
	KernelTelemetrySink,
	KernelWindows,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import { Navigation, Notifications, Onboarding, SHELL_DEFINITIONS } from "../contracts";
import { createShellMainEntry } from "./entry";

const hosts: PluginHost[] = [];

afterEach(async () => {
	vi.useRealTimers();
	for (const host of hosts.splice(0)) await host.dispose();
});

/** kilo.shell's main entry, a window half that does nothing, and a guest plugin calling from the window. */
async function boot() {
	const host = await createPluginHost([
		{
			manifest,
			definitions: SHELL_DEFINITIONS,
			main: createShellMainEntry(),
			web: { activate: () => {} },
		},
		{
			manifest: testManifest("acme.guest"),
			web: { activate: () => {} },
			main: { activate: () => {} },
		},
	]);
	hosts.push(host);
	const navigation = host.main.kernelSdk.domainObjects.get(Navigation)!;
	const navigated: unknown[] = [];
	const dialogs: unknown[] = [];
	const takeovers: unknown[] = [];
	navigation.on("navigate-requested", (request) => navigated.push(request));
	navigation.on("dialog-requested", (request) => dialogs.push(request));
	navigation.on("takeover-requested", (request) => takeovers.push({ open: request }));
	navigation.on("takeover-close-requested", (request) => takeovers.push({ close: request }));
	const notifications = host.main.kernelSdk.domainObjects.get(Notifications)!;
	const toasts: unknown[] = [];
	notifications.on("toast", (toast) => toasts.push(toast));
	return { host, navigation, navigated, dialogs, takeovers, notifications, toasts };
}

const report = (host: PluginHost, path: string, search: Record<string, string> = {}) =>
	host.invoke(Navigation, "reportLocation", { path, search }, { as: "kilo.shell" });

describe("navigation (main)", () => {
	it("keeps where each kilo.shell window says it is", async () => {
		const { host, navigation } = await boot();

		await report(host, "/settings/about", { tab: "1" });

		expect(navigation.getState().windows).toEqual({
			main: { path: "/settings/about", search: { tab: "1" } },
		});
		expect(navigation.lookup("main")).toEqual({ path: "/settings/about", search: { tab: "1" } });
	});

	it("takes locations only from kilo.shell's windows", async () => {
		const { host } = await boot();

		await expect(
			host.invoke(Navigation, "reportLocation", { path: "/", search: {} }, { as: "acme.guest" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			host.main.kernelSdk.domainObjects
				.get(Navigation)!
				.methods.reportLocation({ path: "/", search: {} }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});

	it("asks the caller's own window to move, and settings sections become paths", async () => {
		const { host, navigated } = await boot();

		await host.invoke(Navigation, "openSettings", { section: "about" }, { as: "acme.guest" });
		await host.invoke(
			Navigation,
			"openSettings",
			{ section: "kilo.shell/account" },
			{ as: "acme.guest" },
		);
		await host.invoke(Navigation, "openSettings", {}, { as: "acme.guest" });
		await host.invoke(Navigation, "goHome", {}, { as: "acme.guest" });
		await host.invoke(
			Navigation,
			"navigate",
			{ path: "/x", search: { a: "b" } },
			{ as: "acme.guest" },
		);

		expect(navigated).toEqual([
			{ windowId: "main", path: "/settings/about", search: {} },
			{ windowId: "main", path: "/settings/account", search: {} },
			{ windowId: "main", path: "/settings", search: {} },
			{ windowId: "main", path: "/", search: {} },
			{ windowId: "main", path: "/x", search: { a: "b" } },
		]);
	});

	it("sends a main-process request to the window it names, else the main window", async () => {
		const { host, navigated, dialogs } = await boot();
		const navigation = host.main.sdkFor("acme.guest").domainObjects.get(Navigation)!;

		await navigation.methods.navigate({ path: "/a", windowId: "w2" });
		await expect(navigation.methods.goHome({})).rejects.toMatchObject({ code: "UNAVAILABLE" });
		await report(host, "/");
		await navigation.methods.goHome({});
		host.main.windowEvents.opened("w1", { role: "main" });
		await navigation.methods.openDialog({ dialog: "acme.guest/pick", input: { n: 1 } });

		expect(navigated).toEqual([
			{ windowId: "w2", path: "/a", search: {} },
			{ windowId: "main", path: "/", search: {} },
		]);
		expect(dialogs).toEqual([{ windowId: "w1", dialog: "acme.guest/pick", input: { n: 1 } }]);
	});

	it("asks a window to show and close a take-over", async () => {
		const { host, takeovers } = await boot();

		await host.invoke(
			Navigation,
			"openTakeover",
			{ takeover: "acme.guest/reader", input: { at: 3 } },
			{ as: "acme.guest" },
		);
		await host.invoke(Navigation, "closeTakeover", {}, { as: "acme.guest" });
		await host.invoke(
			Navigation,
			"openTakeover",
			{ takeover: "acme.guest/reader", windowId: "w2" },
			{ as: "acme.guest" },
		);

		expect(takeovers).toEqual([
			{ open: { windowId: "main", takeover: "acme.guest/reader", input: { at: 3 } } },
			{ close: { windowId: "main" } },
			{ open: { windowId: "w2", takeover: "acme.guest/reader" } },
		]);
	});

	it("sends a secondary window's request to the main window", async () => {
		const { host, navigated } = await boot();
		host.main.windowEvents.opened("main", { role: "main" });
		host.main.windowEvents.opened("pop", { role: "secondary" });
		const popout = await host.openWindow("pop", {
			role: "secondary",
			view: "acme.guest/v",
			params: {},
		});

		await popout.sdkFor("acme.guest").domainObjects.get(Navigation)!.methods.goHome({});

		expect(navigated).toEqual([{ windowId: "main", path: "/", search: {} }]);
	});

	it("forgets a window when it closes", async () => {
		const { host, navigation } = await boot();
		host.main.windowEvents.opened("main", { role: "main" });
		await report(host, "/");

		host.main.windowEvents.closed("main");

		expect(navigation.getState().windows).toEqual({});
		expect(host.main.kernelSdk.domainObjects.get(KernelWindows)!.getState().windows).toEqual({});
	});
});

describe("notifications (main)", () => {
	it("sends a toast to the caller's window, saying who raised it", async () => {
		const { host, toasts } = await boot();

		await host.invoke(Notifications, "toast", { title: "Saved" }, { as: "acme.guest" });

		expect(toasts).toEqual([
			{ title: "Saved", level: "info", windowId: "main", pluginId: "acme.guest" },
		]);
	});

	it("keeps notices per plugin, replacing the same id and dismissing by id or key", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(7);
		const { host, notifications } = await boot();
		const guest = host.main.sdkFor("acme.guest").domainObjects.get(Notifications)!;

		const key = await guest.methods.post({ id: "sync", title: "Sync paused", level: "warning" });
		await guest.methods.post({ id: "sync", title: "Sync failed", level: "error" });
		const other = await host.invoke(
			Notifications,
			"post",
			{ title: "Hello" },
			{ as: "kilo.shell" },
		);

		expect(key).toBe("acme.guest/sync");
		expect(other).toMatch(/^kilo\.shell\/[0-9a-f-]{36}$/);
		expect(notifications.getState().notices).toEqual({
			"acme.guest/sync": {
				id: "acme.guest/sync",
				pluginId: "acme.guest",
				title: "Sync failed",
				level: "error",
				createdAt: 7,
			},
			[other]: {
				id: other,
				pluginId: "kilo.shell",
				title: "Hello",
				level: "info",
				createdAt: 7,
			},
		});

		await guest.methods.dismiss({ id: "sync" });
		await host.invoke(Notifications, "dismiss", { id: other }, { as: "acme.guest" });
		await guest.methods.dismiss({ id: "gone" });

		expect(notifications.getState().notices).toEqual({});
	});
});

describe("telemetry (main)", () => {
	async function bootWithSink() {
		const envelopes: TelemetryEnvelope[] = [];
		const host = await createPluginHost([
			{
				manifest,
				definitions: SHELL_DEFINITIONS,
				main: createShellMainEntry(),
				web: { activate: () => {} },
			},
			{
				manifest: testManifest("acme.sink", {
					contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
				}),
				main: {
					activate: (sdk) => {
						sdk.extensions.implement(KernelTelemetrySink, "sink", {
							deliver: (envelope) => void envelopes.push(envelope),
						});
					},
				},
			},
		]);
		hosts.push(host);
		host.main.kernelSdk.domainObjects.provide(KernelDataCollection, {
			initialState: { choice: true, allowed: true, installationId: "i", environment: "preview" },
			methods: { setChoice: () => {} },
		});
		// The daily reading-preferences snapshot has its own tests (reading.test.ts).
		const sent = () =>
			envelopes
				.filter(({ name }) => name !== "Reading Preferences Snapshot")
				.map(({ name, data }) => ({ name, data }));
		return { host, sent };
	}

	it("reports page visits with origin's paths, once per new path", async () => {
		const { host, sent } = await bootWithSink();

		await report(host, "/settings/about");
		await report(host, "/settings/about", { q: "x" });
		await report(host, "/");

		await expect.poll(sent).toEqual([
			{ name: "Page Visit", data: { path: "/settings/about" } },
			{ name: "Page Visit", data: { path: "/plugins/chat" } },
		]);
	});

	it("reports onboarding shown, completed and skipped", async () => {
		const { host, sent } = await bootWithSink();
		const onboarding = host.main.kernelSdk.domainObjects.get(Onboarding)!;

		await onboarding.methods.markShown(undefined);
		await onboarding.methods.complete(undefined);
		await onboarding.methods.skip(undefined);

		await expect.poll(sent).toEqual([
			{ name: "Onboarding Shown", data: {} },
			{ name: "Onboarding Completed", data: {} },
			{ name: "Onboarding Skipped", data: {} },
		]);
	});
});
