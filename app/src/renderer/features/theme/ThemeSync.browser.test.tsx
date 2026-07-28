import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi, IpcEventPayload } from "$shared";

import { ThemeSync } from "./ThemeSync";

type ThemeState = IpcEventPayload<"theme:changed">;

afterEach(() => {
	cleanup();
	document.documentElement.classList.remove("dark");
	document.documentElement.style.removeProperty("color-scheme");
	vi.restoreAllMocks();
});

describe("ThemeSync", () => {
	it("applies the initial theme and responds to push updates", async () => {
		let listener: ((state: ThemeState) => void) | undefined;
		const unsubscribe = vi.fn();
		window.desktopApi = {
			invoke: vi.fn().mockResolvedValue({
				ok: true,
				value: { source: "dark", shouldUseDarkColors: true },
			}),
			on: vi.fn((_channel, nextListener) => {
				listener = nextListener as (state: ThemeState) => void;
				return unsubscribe;
			}),
		} as unknown as DesktopApi;

		const { unmount } = render(<ThemeSync />);
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);

		listener?.({ source: "light", shouldUseDarkColors: false });
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);

		unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
