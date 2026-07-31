import {
	LocalApiError,
	type LocalApi,
	type ThemeSource,
	type ThemeState,
} from "@anaconda-agentic-desktop/contracts";

function resolveShouldUseDarkColors(source: ThemeSource): boolean {
	if (source === "dark") return true;
	if (source === "light") return false;
	return globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function createBrowserLocalApi(): LocalApi {
	let themeSource: ThemeSource = "system";
	const themeListeners = new Set<(state: ThemeState) => void>();
	let mediaQuery: MediaQueryList | undefined;
	let mediaListener: ((event: MediaQueryListEvent) => void) | undefined;

	const currentTheme = (): ThemeState => ({
		source: themeSource,
		shouldUseDarkColors: resolveShouldUseDarkColors(themeSource),
	});

	const emitTheme = (): void => {
		const state = currentTheme();
		for (const listener of themeListeners) listener(state);
	};

	const syncMediaListener = (): void => {
		if (themeSource !== "system" || themeListeners.size === 0) {
			if (mediaQuery && mediaListener) {
				mediaQuery.removeEventListener("change", mediaListener);
			}
			mediaQuery = undefined;
			mediaListener = undefined;
			return;
		}

		if (mediaQuery && mediaListener) return;

		mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
		mediaListener = (event) => {
			const state: ThemeState = {
				source: "system",
				shouldUseDarkColors: event.matches,
			};
			for (const listener of themeListeners) listener(state);
		};
		mediaQuery.addEventListener("change", mediaListener);
	};

	return {
		theme: {
			async get() {
				return currentTheme();
			},
			async set(input) {
				themeSource = input.source;
				syncMediaListener();
				const state = currentTheme();
				emitTheme();
				return state;
			},
			onChanged(listener) {
				themeListeners.add(listener);
				syncMediaListener();
				return () => {
					themeListeners.delete(listener);
					syncMediaListener();
				};
			},
		},
		shell: {
			async openExternal(input) {
				const opened = globalThis.open(input.url, "_blank", "noopener,noreferrer");
				if (!opened) {
					throw new LocalApiError("TRANSPORT", "Could not open the external URL.");
				}
				return { opened: true };
			},
			async copyText(input) {
				try {
					await navigator.clipboard.writeText(input.text);
				} catch {
					throw new LocalApiError("TRANSPORT", "Could not copy text to the clipboard.");
				}
			},
		},
	};
}
