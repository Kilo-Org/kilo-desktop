import {
	resolveColorScheme,
	SIDEBAR_VIBRANCY_STORAGE_KEY,
	THEME_STORAGE_KEY,
	themeSourceSchema,
	type ResolvedColorScheme,
	type ThemeSource,
} from "@anaconda-agentic-desktop/contracts";

export type { ResolvedColorScheme, ThemeSource };
export { resolveColorScheme, THEME_STORAGE_KEY };

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

type Listener = () => void;

let resolvedSnapshot: ResolvedColorScheme = readDomResolved();
const listeners = new Set<Listener>();

function readDomResolved(): ResolvedColorScheme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function readStoredThemeSource(): ThemeSource {
	try {
		const parsed = themeSourceSchema.safeParse(globalThis.localStorage.getItem(THEME_STORAGE_KEY));
		if (parsed.success) return parsed.data;
	} catch {
		// localStorage throws in private browsing / when disabled — fall back to default.
	}
	return "system";
}

export function persistThemeSource(source: ThemeSource): void {
	try {
		globalThis.localStorage.setItem(THEME_STORAGE_KEY, source);
	} catch {
		// Best-effort persistence; the in-memory state still applies for this session.
	}
}

export function readStoredSidebarVibrancy(): boolean {
	try {
		return globalThis.localStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY) !== "false";
	} catch {
		return true;
	}
}

export function persistSidebarVibrancy(enabled: boolean): void {
	try {
		globalThis.localStorage.setItem(SIDEBAR_VIBRANCY_STORAGE_KEY, String(enabled));
	} catch {
		// Best-effort persistence; the in-memory state still applies for this session.
	}
}

/** Subscribe to resolved scheme changes (for sdk.theme / useSyncExternalStore). */
export function subscribeColorScheme(onStoreChange: Listener): () => void {
	listeners.add(onStoreChange);
	return () => {
		listeners.delete(onStoreChange);
	};
}

export function getColorSchemeSnapshot(): ResolvedColorScheme {
	return resolvedSnapshot;
}

/**
 * Applies the resolved scheme to the document and notifies subscribers.
 * DOM contract matches Tailwind: `[data-theme="dark"]`.
 */
export function applyDocumentColorScheme(resolved: ResolvedColorScheme): void {
	const root = document.documentElement;
	if (resolved === "dark") {
		root.dataset.theme = "dark";
	} else {
		delete root.dataset.theme;
	}
	root.style.colorScheme = resolved;

	if (resolvedSnapshot === resolved) return;
	resolvedSnapshot = resolved;
	for (const listener of listeners) listener();
}
