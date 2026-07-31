import {
	createContext,
	use,
	useCallback,
	useEffect,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import type { ThemeSource } from "@anaconda-agentic-desktop/contracts";

import { useLocalApi } from "@/platform/LocalApiProvider";
import {
	applyDocumentColorScheme,
	DARK_SCHEME_QUERY,
	persistThemeSource,
	readStoredThemeSource,
	resolveColorScheme,
	type ResolvedColorScheme,
} from "@/platform/theme/color-scheme";

function subscribeSystemScheme(onChange: () => void): () => void {
	const media = globalThis.matchMedia(DARK_SCHEME_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

function getSystemSchemeSnapshot(): boolean {
	return globalThis.matchMedia(DARK_SCHEME_QUERY).matches;
}

interface ColorSchemeContextValue {
	readonly source: ThemeSource;
	readonly resolved: ResolvedColorScheme;
	readonly setSource: (source: ThemeSource) => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const api = useLocalApi();
	const [source, setSourceState] = useState<ThemeSource>(readStoredThemeSource);
	const systemDark = useSyncExternalStore(subscribeSystemScheme, getSystemSchemeSnapshot);
	const resolved = resolveColorScheme(source, systemDark);

	useEffect(() => {
		applyDocumentColorScheme(resolved);
		void api.theme.sync({ source, shouldUseDarkColors: resolved === "dark" }).catch((error) => {
			console.warn("[theme] failed to sync chrome to host", error);
		});
	}, [api, source, resolved]);

	const setSource = useCallback((next: ThemeSource) => {
		setSourceState(next);
		persistThemeSource(next);
	}, []);

	return (
		<ColorSchemeContext value={{ source, resolved, setSource }}>{children}</ColorSchemeContext>
	);
}

export function useColorScheme(): ColorSchemeContextValue {
	const value = use(ColorSchemeContext);
	if (!value) throw new Error("useColorScheme must be used within ThemeProvider.");
	return value;
}
