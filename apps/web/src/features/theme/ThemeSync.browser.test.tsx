import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalApi, ThemeState } from "@anaconda-agentic-desktop/contracts";

import { LocalApiProvider } from "@/platform/LocalApiProvider";

import { ThemeSync } from "./ThemeSync";

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
		const api: LocalApi = {
			todos: {
				list: async () => [],
				add: async ({ title }) => ({ id: "1", title, completed: false }),
				toggle: async ({ id }) => ({ id, title: "x", completed: true }),
			},
			theme: {
				get: vi.fn().mockResolvedValue({ source: "dark", shouldUseDarkColors: true }),
				set: async ({ source }) => ({ source, shouldUseDarkColors: source === "dark" }),
				onChanged: vi.fn((nextListener) => {
					listener = nextListener;
					return unsubscribe;
				}),
			},
			shell: {
				openExternal: async () => ({ opened: true }),
				copyText: async () => undefined,
			},
		};

		const { unmount } = render(
			<LocalApiProvider api={api}>
				<ThemeSync />
			</LocalApiProvider>,
		);
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);

		listener?.({ source: "light", shouldUseDarkColors: false });
		await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);

		unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
