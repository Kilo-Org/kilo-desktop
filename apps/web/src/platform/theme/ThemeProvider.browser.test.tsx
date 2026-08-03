import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { LocalApi, ThemeState } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { LocalApiProvider } from "@/platform/LocalApiProvider";

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
	const { source, resolved, setSource } = useColorScheme();
	return (
		<div>
			<span data-qa-id="source">{source}</span>
			<span data-qa-id="resolved">{resolved}</span>
			<button data-qa-id="set-dark" onClick={() => setSource("dark")}>
				dark
			</button>
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
	globalThis.localStorage.clear();
	applyDocumentColorScheme("light");
});

describe("ThemeProvider", () => {
	it("applies the persisted dark source on mount and syncs chrome", async () => {
		stubMatchMedia(false);
		globalThis.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		const sync = vi.fn<(state: ThemeState) => Promise<void>>().mockResolvedValue(undefined);
		const api = withThemeSync(createBrowserLocalApi(), sync);

		renderProvider(api);

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(document.documentElement.style.colorScheme).toBe("dark");
		expect(sync).toHaveBeenCalledWith({ source: "dark", shouldUseDarkColors: true });
	});

	it("follows the OS scheme while source is system", async () => {
		const os = stubMatchMedia(false);
		const sync = vi.fn<(state: ThemeState) => Promise<void>>().mockResolvedValue(undefined);
		const api = withThemeSync(createBrowserLocalApi(), sync);

		renderProvider(api);

		await expect.poll(() => document.documentElement.style.colorScheme).toBe("light");
		expect(document.documentElement.dataset.theme).toBeUndefined();
		expect(sync).toHaveBeenCalledWith({ source: "system", shouldUseDarkColors: false });

		os.setDark(true);

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(sync).toHaveBeenCalledWith({ source: "system", shouldUseDarkColors: true });
	});

	it("persists explicit source changes and updates the DOM", async () => {
		stubMatchMedia(true);
		const sync = vi.fn<(state: ThemeState) => Promise<void>>().mockResolvedValue(undefined);
		const api = withThemeSync(createBrowserLocalApi(), sync);

		const { baseElement } = renderProvider(api);
		const screen = page.elementLocator(baseElement);

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");

		await screen.getByTestId("set-light").click();

		await expect.poll(() => document.documentElement.style.colorScheme).toBe("light");
		expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
		expect(sync).toHaveBeenCalledWith({ source: "light", shouldUseDarkColors: false });

		await screen.getByTestId("set-dark").click();

		await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
		expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
	});
});
