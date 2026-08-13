import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { LocalApi, ThemeState } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";
import {
	DARK_SCHEME_QUERY,
	THEME_STORAGE_KEY,
	applyDocumentColorScheme,
} from "@/platform/theme/color-scheme";
import { ThemeProvider } from "@/platform/theme/ThemeProvider";

import { AppearanceSettings } from "./AppearanceSettings";

function withThemeSync(api: LocalApi, sync: (state: ThemeState) => Promise<void>): LocalApi {
	return { ...api, theme: { sync } };
}

function stubMatchMedia(initialDark: boolean) {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const media = {
		matches: initialDark,
		addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
			listeners.add(listener);
		}),
		removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
			listeners.delete(listener);
		}),
	};
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => {
			if (query !== DARK_SCHEME_QUERY) throw new Error(`Unexpected media query: ${query}`);
			return media;
		}),
	);
}

function renderAppearance(api: LocalApi = createBrowserLocalApi()) {
	return render(
		<LocalApiProvider api={api}>
			<ThemeProvider>
				<AppearanceSettings />
			</ThemeProvider>
		</LocalApiProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	globalThis.localStorage.clear();
	applyDocumentColorScheme("light");
});

describe("AppearanceSettings", () => {
	it("selects Light, Dark, and System and persists the source", async () => {
		stubMatchMedia(true);
		const sync = vi.fn<(state: ThemeState) => Promise<void>>().mockResolvedValue(undefined);
		const { baseElement } = renderAppearance(withThemeSync(createBrowserLocalApi(), sync));
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("appearance-settings")).toBeVisible();
		await expect
			.element(screen.getByRole("radio", { name: "System" }))
			.toHaveAttribute("aria-checked", "true");

		await screen.getByTestId("appearance-theme-light").click();
		await expect.poll(() => document.documentElement.style.colorScheme).toBe("light");
		expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
		expect(sync).toHaveBeenCalledWith({ source: "light", shouldUseDarkColors: false });

		await screen.getByTestId("appearance-theme-dark").click();
		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
		expect(sync).toHaveBeenCalledWith({ source: "dark", shouldUseDarkColors: true });

		await screen.getByTestId("appearance-theme-system").click();
		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
		expect(sync).toHaveBeenCalledWith({ source: "system", shouldUseDarkColors: true });
	});
});
