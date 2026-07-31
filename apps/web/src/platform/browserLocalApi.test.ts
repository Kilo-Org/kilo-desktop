import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserLocalApi } from "./browserLocalApi";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createBrowserLocalApi", () => {
	it("treats theme sync as a no-op outside Electron", async () => {
		const api = createBrowserLocalApi();
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).resolves.toBeUndefined();
	});

	it("opens external URLs and copies text", async () => {
		const open = vi.fn(() => ({}) as Window);
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("open", open);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const api = createBrowserLocalApi();
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
});
