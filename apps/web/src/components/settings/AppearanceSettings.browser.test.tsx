import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { LocalApi } from "@kilo-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";
import { DARK_SCHEME_QUERY, applyDocumentColorScheme } from "@/platform/theme/color-scheme";
import { ThemeProvider } from "@/platform/theme/ThemeProvider";

import { AppearanceSettings } from "./AppearanceSettings";

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
	document.getElementById("app-theme")?.remove();
	applyDocumentColorScheme("light");
});

describe("AppearanceSettings", () => {
	it("switches Dracula live and restores it after remount", async () => {
		stubMatchMedia(true);
		const mounted = renderAppearance();

		await page.getByRole("combobox", { name: "Color theme" }).click();
		await page.getByRole("option", { name: "Dracula", exact: true }).click();
		await expect
			.poll(() =>
				getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
			)
			.toBe("#282a36");
		mounted.unmount();
		renderAppearance();
		await expect.element(page.getByText("Dracula", { exact: true })).toBeVisible();
		await page.getByTestId("appearance-theme-light").click();
		await expect
			.poll(() =>
				getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
			)
			.toBe("#f8f7fc");
	});

	it("toggles vibrancy for the default Kilo theme", async () => {
		stubMatchMedia(true);
		renderAppearance();
		const opacity = () =>
			getComputedStyle(document.documentElement).getPropertyValue("--shell-glass-opacity").trim();

		expect(opacity()).toBe("80%");
		await page.getByTestId("appearance-sidebar-vibrancy").click();
		await expect.poll(opacity).toBe("100%");
	});

	it("persists Blue and restores Theme without leftover overrides", async () => {
		stubMatchMedia(true);
		const mounted = renderAppearance();
		await page.getByRole("combobox", { name: "Color theme" }).click();
		await page.getByRole("option", { name: "Dracula", exact: true }).click();
		await page.getByTestId("appearance-accent-blue").click();
		await expect
			.element(page.getByTestId("appearance-accent-blue"))
			.toHaveAttribute("aria-pressed", "true");
		mounted.unmount();
		renderAppearance();
		await expect
			.element(page.getByTestId("appearance-accent-blue"))
			.toHaveAttribute("aria-pressed", "true");
		await page.getByRole("combobox", { name: "Color theme" }).click();
		await page.getByRole("option", { name: "Anaconda", exact: true }).click();
		await page.getByTestId("appearance-accent-theme").click();
		await expect.poll(() => document.getElementById("app-theme")).toBeNull();
	});

	it("selects Light, Dark, and System", async () => {
		stubMatchMedia(true);
		const { baseElement } = renderAppearance();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("appearance-settings")).toBeVisible();
		await expect.element(screen.getByText("Kilo", { exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole("radio", { name: "System" }))
			.toHaveAttribute("aria-checked", "true");

		await screen.getByTestId("appearance-theme-light").click();
		await expect.poll(() => document.documentElement.style.colorScheme).toBe("light");

		await screen.getByTestId("appearance-theme-dark").click();
		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");

		await screen.getByTestId("appearance-theme-system").click();
		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
	});
});
