import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	DEFAULT_APP_THEME_PREFERENCES,
	type LocalApi,
	type ThemeState,
} from "@kilo-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";

import { applyAppTheme } from "./app-theme";
import { DARK_SCHEME_QUERY, THEME_STORAGE_KEY, applyDocumentColorScheme } from "./color-scheme";
import { ThemeProvider, useColorScheme } from "./ThemeProvider";

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
	return {
		setDark(next: boolean) {
			media.matches = next;
			for (const listener of listeners) {
				listener({ matches: next } as MediaQueryListEvent);
			}
		},
	};
}

function Harness() {
	const { source, resolved, setSource, appTheme } = useColorScheme();
	return (
		<div>
			<span data-qa-id="source">{source}</span>
			<span data-qa-id="resolved">{resolved}</span>
			<span data-qa-id="app-theme-id">{appTheme.themeId}</span>
			<button data-qa-id="set-light" onClick={() => setSource("light")}>
				light
			</button>
		</div>
	);
}

function renderProvider(api: LocalApi) {
	return render(
		<LocalApiProvider api={api}>
			<ThemeProvider>
				<Harness />
			</ThemeProvider>
		</LocalApiProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	applyAppTheme(DEFAULT_APP_THEME_PREFERENCES);
	globalThis.localStorage.clear();
	document.getElementById("app-theme")?.remove();
	applyDocumentColorScheme("light");
});

describe("ThemeProvider", () => {
	it("recovers invalid preferences and follows appearance changes from another window", async () => {
		stubMatchMedia(true);
		localStorage.setItem("appTheme:v1", "{broken");
		const { baseElement } = renderProvider(createBrowserLocalApi());
		const screen = page.elementLocator(baseElement);
		expect(getComputedStyle(document.documentElement).getPropertyValue("--background").trim()).toBe(
			"#111111",
		);
		expect(getComputedStyle(document.documentElement).getPropertyValue("--card").trim()).toBe(
			"#181818",
		);
		localStorage.setItem("appTheme:v1", JSON.stringify({ themeId: "dracula", accentId: "theme" }));
		window.dispatchEvent(
			new StorageEvent("storage", { key: "appTheme:v1", storageArea: localStorage }),
		);
		await expect
			.poll(() =>
				getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
			)
			.toBe("#282a36");
		await expect.element(screen.getByTestId("app-theme-id")).toHaveTextContent("dracula");
		localStorage.removeItem("appTheme:v1");
		window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
		await expect
			.poll(() =>
				getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
			)
			.toBe("#111111");
	});

	it("applies persisted source even when host chrome sync rejects", async () => {
		stubMatchMedia(false);
		globalThis.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		const sync = vi
			.fn<(state: ThemeState) => Promise<void>>()
			.mockRejectedValue(new Error("host unavailable"));
		const api = withThemeSync(createBrowserLocalApi(), sync);

		expect(() => renderProvider(api)).not.toThrow();

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(document.documentElement.style.colorScheme).toBe("dark");
		expect(sync).toHaveBeenCalledWith({
			source: "dark",
			themeId: "kilo",
		});
	});

	it("follows the OS scheme and resyncs native chrome while source is system", async () => {
		const os = stubMatchMedia(false);
		const sync = vi.fn<(state: ThemeState) => Promise<void>>().mockResolvedValue(undefined);
		const api = withThemeSync(createBrowserLocalApi(), sync);

		renderProvider(api);

		await expect.poll(() => document.documentElement.style.colorScheme).toBe("light");
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(sync).toHaveBeenCalledWith({
			source: "system",
			themeId: "kilo",
		});
		const lightSyncCount = sync.mock.calls.length;

		os.setDark(true);

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		await expect.poll(() => sync.mock.calls.length).toBe(lightSyncCount + 1);
		expect(sync).toHaveBeenLastCalledWith({
			source: "system",
			themeId: "kilo",
		});
	});

	it("persists explicit source changes and updates the DOM", async () => {
		stubMatchMedia(true);
		const { baseElement } = renderProvider(createBrowserLocalApi());
		const screen = page.elementLocator(baseElement);

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");

		await screen.getByTestId("set-light").click();

		await expect.poll(() => document.documentElement.style.colorScheme).toBe("light");
		expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
	});

	it("throws from useColorScheme when used outside a ThemeProvider", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			expect(() => render(<Harness />)).toThrow(/useColorScheme must be used within ThemeProvider/);
		} finally {
			error.mockRestore();
		}
	});
});
