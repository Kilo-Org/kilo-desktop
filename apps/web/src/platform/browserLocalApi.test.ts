import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserLocalApi } from "./browserLocalApi";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createBrowserLocalApi", () => {
	it("treats theme sync as a no-op outside Electron", async () => {
		const api = createBrowserLocalApi();
		await expect(api.theme.sync({ source: "dark", themeId: "dracula" })).resolves.toBeUndefined();
	});

	it("opens external URLs and copies text", async () => {
		const open = vi.fn(() => ({}) as Window);
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("open", open);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const api = createBrowserLocalApi();
		expect(api.shell.canPickDirectories).toBe(false);
		expect(api.shell.onNavigate(() => undefined)).toBeTypeOf("function");
		await expect(api.shell.openExternal({ url: "https://example.com" })).resolves.toEqual({
			opened: true,
		});
		expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");

		await api.shell.copyText({ text: "hello" });
		expect(writeText).toHaveBeenCalledWith("hello");
	});

	it("throws TRANSPORT errors when shell operations fail", async () => {
		vi.stubGlobal(
			"open",
			vi.fn(() => null),
		);
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
		});

		const api = createBrowserLocalApi();
		await expect(api.shell.openExternal({ url: "https://example.com" })).rejects.toMatchObject({
			code: "TRANSPORT",
		});
		await expect(api.shell.copyText({ text: "hello" })).rejects.toMatchObject({
			code: "TRANSPORT",
		});
		await expect(api.shell.showItemInFolder({ path: "/tmp/model.gguf" })).rejects.toMatchObject({
			code: "TRANSPORT",
			message: "Revealing files requires the desktop app.",
		});
		await expect(
			api.shell.showOpenDialog({ kind: "directory", multiple: true }),
		).rejects.toMatchObject({
			code: "TRANSPORT",
			message: "Folder selection requires the desktop app.",
		});
		expect(api.shell.getPathForFile(new File([], "folder"))).toBeNull();
	});

	it("shows web notifications only when permission is already granted", async () => {
		const created: Array<{ title: string; options?: NotificationOptions }> = [];
		class FakeNotification {
			static permission: NotificationPermission = "granted";
			constructor(title: string, options?: NotificationOptions) {
				created.push({ title, ...(options ? { options } : {}) });
			}
		}
		vi.stubGlobal("Notification", FakeNotification);

		const api = createBrowserLocalApi();
		await expect(
			api.notifications.show({ title: "Hi", message: "There", type: "info" }),
		).resolves.toEqual({ delivered: true });
		expect(created).toEqual([{ title: "Hi", options: { body: "There" } }]);

		FakeNotification.permission = "denied";
		const denied = await api.notifications.show({ title: "Hi", message: "There", type: "info" });
		expect(denied.delivered).toBe(false);
		expect(denied.reason).toMatch(/permission/);
	});

	it("reports undelivered instead of throwing when the Notification constructor throws", async () => {
		class ThrowingNotification {
			static permission: NotificationPermission = "granted";
			constructor() {
				throw new TypeError("must use ServiceWorkerRegistration.showNotification");
			}
		}
		vi.stubGlobal("Notification", ThrowingNotification);
		const api = createBrowserLocalApi();
		const result = await api.notifications.show({ title: "Hi", message: "There", type: "info" });
		expect(result.delivered).toBe(false);
		expect(result.reason).toMatch(/could not be shown/);
	});

	it("sets the app badge when the Badging API is available", async () => {
		const setAppBadge = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { setAppBadge });
		const api = createBrowserLocalApi();
		await expect(api.notifications.setBadge({ count: 2 })).resolves.toEqual({ delivered: true });
		expect(setAppBadge).toHaveBeenCalledWith(2);

		setAppBadge.mockRejectedValueOnce(new Error("nope"));
		const failed = await api.notifications.setBadge({ count: 2 });
		expect(failed.delivered).toBe(false);

		vi.stubGlobal("navigator", {});
		const unsupported = await api.notifications.setBadge({ count: 2 });
		expect(unsupported.delivered).toBe(false);
		expect(unsupported.reason).toMatch(/not supported/);
	});

	it("rejects every fs method — no filesystem sandbox in browser mode", async () => {
		const api = createBrowserLocalApi();
		const scope = { featureId: "demo", path: "x.txt" };
		await expect(api.fs.readFile(scope)).rejects.toMatchObject({ code: "TRANSPORT" });
		await expect(api.fs.writeFile({ ...scope, content: "y" })).rejects.toThrow(
			/not available in browser mode/,
		);
		await expect(api.fs.exists(scope)).rejects.toThrow(/not available in browser mode/);
		await expect(api.fs.mkdir(scope)).rejects.toThrow(/not available in browser mode/);
		await expect(api.fs.readdir(scope)).rejects.toThrow(/not available in browser mode/);
		await expect(api.fs.remove(scope)).rejects.toThrow(/not available in browser mode/);
	});

	it("reports an anonymous auth session with a no-op onChanged", async () => {
		const api = createBrowserLocalApi();
		expect(await api.auth.getSession()).toEqual({ status: "anonymous" });
		expect(await api.auth.refresh()).toEqual({ status: "anonymous" });
		expect(await api.auth.logout()).toEqual({ status: "anonymous" });

		const listener = vi.fn();
		const unsubscribe = api.auth.onChanged(listener);
		expect(listener).not.toHaveBeenCalled();
		expect(() => unsubscribe()).not.toThrow();
	});

	it("resolves feature flags to their defaults with a no-op onChanged", async () => {
		const api = createBrowserLocalApi();
		expect(await api.featureFlags.getAllFlags()).toEqual({});

		const listener = vi.fn();
		const unsubscribe = api.featureFlags.onChanged(listener);
		expect(listener).not.toHaveBeenCalled();
		expect(() => unsubscribe()).not.toThrow();
	});

	it("drops telemetry events as a no-op outside Electron", async () => {
		const api = createBrowserLocalApi();
		await expect(api.telemetry.track({ event: "PAGE_VISIT", data: {} })).resolves.toBeUndefined();
	});
});
