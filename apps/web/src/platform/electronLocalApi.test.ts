import { describe, expect, it, vi } from "vitest";

import { LocalApiError, type DesktopApi } from "@anaconda-agentic-desktop/contracts";

import { createElectronLocalApi } from "./electronLocalApi";

function makeBridge(overrides?: Partial<DesktopApi>): DesktopApi {
	return {
		getPathForFile: vi.fn(() => null),
		invoke: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		on: vi.fn(() => () => undefined),
		...overrides,
	} as unknown as DesktopApi;
}

describe("createElectronLocalApi", () => {
	it("forwards theme/shell methods through the bridge", async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, value: undefined })
			.mockResolvedValueOnce({ ok: true, value: { opened: true } })
			.mockResolvedValueOnce({ ok: true, value: undefined })
			.mockResolvedValueOnce({
				ok: true,
				value: { canceled: false, paths: ["/tmp/project"] },
			});
		const on = vi.fn(() => () => undefined);
		const getPathForFile = vi.fn(() => "/tmp/dropped");
		const api = createElectronLocalApi({ invoke, on, getPathForFile } as unknown as DesktopApi);
		expect(api.shell.canPickDirectories).toBe(true);

		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).resolves.toBeUndefined();
		await expect(api.shell.openExternal({ url: "https://example.com" })).resolves.toEqual({
			opened: true,
		});
		await expect(api.shell.copyText({ text: "hi" })).resolves.toBeUndefined();
		await expect(api.shell.showOpenDialog({ kind: "directory", multiple: true })).resolves.toEqual({
			canceled: false,
			paths: ["/tmp/project"],
		});
		const file = new File([], "project");
		expect(api.shell.getPathForFile(file)).toBe("/tmp/dropped");
		expect(getPathForFile).toHaveBeenCalledWith(file);

		expect(invoke).toHaveBeenNthCalledWith(1, "theme:sync", {
			source: "dark",
			shouldUseDarkColors: true,
		});
		expect(invoke).toHaveBeenNthCalledWith(4, "shell:show-open-dialog", {
			kind: "directory",
			multiple: true,
		});

		const unsubscribe = api.auth.onChanged(() => undefined);
		expect(on).toHaveBeenCalledWith("auth:changed", expect.any(Function));
		unsubscribe();
	});

	it("forwards notification and fs methods through the bridge", async () => {
		const invoke = vi.fn(async (channel: string) => {
			switch (channel) {
				case "notifications:show":
				case "notifications:set-badge":
					return { ok: true, value: { delivered: true } };
				case "fs:read-file":
					return { ok: true, value: { content: "hello" } };
				case "fs:exists":
					return { ok: true, value: { exists: true } };
				case "fs:readdir":
					return { ok: true, value: { entries: ["a.txt"] } };
				default:
					return { ok: true, value: undefined };
			}
		});
		const api = createElectronLocalApi(makeBridge({ invoke: invoke as never }));
		const scope = { featureId: "demo", path: "a.txt" };

		await expect(
			api.notifications.show({ title: "Hi", message: "There", type: "info" }),
		).resolves.toEqual({ delivered: true });
		expect(invoke).toHaveBeenCalledWith("notifications:show", {
			title: "Hi",
			message: "There",
			type: "info",
		});
		await expect(api.notifications.setBadge({ count: 3 })).resolves.toEqual({ delivered: true });
		expect(invoke).toHaveBeenCalledWith("notifications:set-badge", { count: 3 });

		await expect(api.fs.readFile(scope)).resolves.toEqual({ content: "hello" });
		expect(invoke).toHaveBeenCalledWith("fs:read-file", scope);
		await expect(api.fs.writeFile({ ...scope, content: "x" })).resolves.toBeUndefined();
		await expect(api.fs.exists(scope)).resolves.toEqual({ exists: true });
		await expect(api.fs.mkdir(scope)).resolves.toBeUndefined();
		await expect(api.fs.readdir(scope)).resolves.toEqual({ entries: ["a.txt"] });
		await expect(api.fs.remove(scope)).resolves.toBeUndefined();
		expect(invoke).toHaveBeenCalledWith("fs:remove", scope);
	});

	it("forwards feature-flag reads and relays feature-flag:changed", async () => {
		const invoke = vi.fn(async (channel: string) => {
			switch (channel) {
				case "feature-flag:get-all":
					return { ok: true, value: { "todos.newEditor": true } };
				default:
					return { ok: true, value: undefined };
			}
		});
		const on = vi.fn(() => () => undefined);
		const api = createElectronLocalApi(makeBridge({ invoke: invoke as never, on }));

		await expect(api.featureFlags.getAllFlags()).resolves.toEqual({ "todos.newEditor": true });

		const unsubscribe = api.featureFlags.onChanged(() => undefined);
		expect(on).toHaveBeenCalledWith("feature-flag:changed", expect.any(Function));
		unsubscribe();
	});

	it("throws LocalApiError when the bridge returns ok: false", async () => {
		const bridge = makeBridge({
			invoke: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "INTERNAL", message: "failed" },
			}),
		});
		const api = createElectronLocalApi(bridge);
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).rejects.toBeInstanceOf(LocalApiError);
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).rejects.toMatchObject({
			code: "INTERNAL",
			message: "failed",
		});
	});
});
