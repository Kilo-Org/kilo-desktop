import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalApi, ThemeState } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";

import { ThemeSync } from "./ThemeSync";

function withTheme(api: LocalApi, theme: LocalApi["theme"]): LocalApi {
	return { ...api, theme };
}

afterEach(() => {
	cleanup();
	document.documentElement.classList.remove("dark");
	delete document.documentElement.dataset.theme;
	document.documentElement.style.removeProperty("color-scheme");
	vi.restoreAllMocks();
});

describe("ThemeSync", () => {
	it("applies the initial theme and responds to push updates", async () => {
		let listener: ((state: ThemeState) => void) | undefined;
		const unsubscribe = vi.fn();
		const api = withTheme(createBrowserLocalApi(), {
			get: vi.fn().mockResolvedValue({ source: "dark", shouldUseDarkColors: true }),
			set: async ({ source }) => ({ source, shouldUseDarkColors: source === "dark" }),
			onChanged: vi.fn((nextListener) => {
				listener = nextListener;
				return unsubscribe;
			}),
		});

		const { unmount } = render(
			<LocalApiProvider api={api}>
				<ThemeSync />
			</LocalApiProvider>,
		);
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");

		listener?.({ source: "light", shouldUseDarkColors: false });
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);
		await expect.poll(() => document.documentElement.dataset.theme).toBeUndefined();

		unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("ignores theme.get results after unmount", async () => {
		let resolveGet: ((state: ThemeState) => void) | undefined;
		const api = withTheme(createBrowserLocalApi(), {
			get: () =>
				new Promise((resolve) => {
					resolveGet = resolve;
				}),
			set: async ({ source }) => ({ source, shouldUseDarkColors: source === "dark" }),
			onChanged: () => () => undefined,
		});

		const { unmount } = render(
			<LocalApiProvider api={api}>
				<ThemeSync />
			</LocalApiProvider>,
		);
		unmount();
		resolveGet?.({ source: "dark", shouldUseDarkColors: true });
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);
	});
});
