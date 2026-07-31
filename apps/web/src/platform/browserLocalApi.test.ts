import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserLocalApi } from "./browserLocalApi";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createBrowserLocalApi", () => {
	it("tracks system theme with matchMedia and cleans up listeners", async () => {
		const listeners = new Set<(event: MediaQueryListEvent) => void>();
		const mediaQuery = {
			matches: true,
			addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
				listeners.add(listener);
			}),
			removeEventListener: vi.fn(
				(_type: string, listener: (event: MediaQueryListEvent) => void) => {
					listeners.delete(listener);
				},
			),
		};
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => mediaQuery),
		);

		const api = createBrowserLocalApi();
		const themeListener = vi.fn();
		const unsubscribe = api.theme.onChanged(themeListener);

		expect(await api.theme.get()).toEqual({ source: "system", shouldUseDarkColors: true });
		expect(mediaQuery.addEventListener).toHaveBeenCalledOnce();

		for (const listener of listeners) {
			listener({ matches: false } as MediaQueryListEvent);
		}
		expect(themeListener).toHaveBeenCalledWith({
			source: "system",
			shouldUseDarkColors: false,
		});

		await api.theme.set({ source: "light" });
		expect(themeListener).toHaveBeenCalledWith({
			source: "light",
			shouldUseDarkColors: false,
		});
		expect(mediaQuery.removeEventListener).toHaveBeenCalled();

		unsubscribe();
		expect(listeners.size).toBe(0);
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

	it("resolves the dark theme without consulting matchMedia", async () => {
		const api = createBrowserLocalApi();
		await api.theme.set({ source: "dark" });
		expect(await api.theme.get()).toEqual({ source: "dark", shouldUseDarkColors: true });
	});
});
