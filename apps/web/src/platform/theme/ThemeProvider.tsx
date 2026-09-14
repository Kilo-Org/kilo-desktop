import {
	createContext,
	use,
	useCallback,
	useEffect,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import {
	APP_THEME_STORAGE_KEY,
	SIDEBAR_VIBRANCY_STORAGE_KEY,
	THEME_STORAGE_KEY,
	type AppThemePreferences,
	type ThemeSource,
} from "@anaconda-agentic-desktop/contracts";

import { useLocalApi } from "@/platform/LocalApiProvider";
import {
	applyAppTheme,
	getAppThemePreferencesSnapshot,
	readStoredAppTheme,
	subscribeAppTheme,
} from "@/platform/theme/app-theme";
import {
	applyDocumentColorScheme,
	DARK_SCHEME_QUERY,
	persistSidebarVibrancy,
	persistThemeSource,
	readStoredSidebarVibrancy,
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
	readonly sidebarVibrancy: boolean;
	readonly setSidebarVibrancy: (enabled: boolean) => void;
	readonly appTheme: AppThemePreferences;
	readonly setAppTheme: (preferences: AppThemePreferences) => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const api = useLocalApi();
	const [source, setSourceState] = useState<ThemeSource>(readStoredThemeSource);
	const [sidebarVibrancy, setSidebarVibrancyState] = useState(readStoredSidebarVibrancy);
	const appTheme = useSyncExternalStore(subscribeAppTheme, getAppThemePreferencesSnapshot);
	const systemDark = useSyncExternalStore(subscribeSystemScheme, getSystemSchemeSnapshot);
	const resolved = resolveColorScheme(source, systemDark);

	useLayoutEffect(() => {
		applyDocumentColorScheme(resolved);
	}, [resolved]);

	useLayoutEffect(() => applyAppTheme(readStoredAppTheme()), []);

	useEffect(() => {
		function onStorage(event: StorageEvent) {
			if (event.storageArea !== localStorage) return;
			if (event.key === null || event.key === APP_THEME_STORAGE_KEY)
				applyAppTheme(readStoredAppTheme());
			if (event.key === null || event.key === THEME_STORAGE_KEY)
				setSourceState(readStoredThemeSource());
			if (event.key === null || event.key === SIDEBAR_VIBRANCY_STORAGE_KEY)
				setSidebarVibrancyState(readStoredSidebarVibrancy());
		}
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	useLayoutEffect(() => {
		const style = document.documentElement.style;
		if (sidebarVibrancy) style.removeProperty("--shell-glass-opacity");
		else style.setProperty("--shell-glass-opacity", "100%");
	}, [sidebarVibrancy]);

	useEffect(() => {
		void api.theme.sync({ source, themeId: appTheme.themeId }).catch((error) => {
			console.warn("[theme] failed to sync chrome to host", error);
		});
	}, [api, source, resolved, appTheme.themeId]);

	const setSource = useCallback((next: ThemeSource) => {
		setSourceState(next);
		persistThemeSource(next);
	}, []);

	const setSidebarVibrancy = useCallback((enabled: boolean) => {
		setSidebarVibrancyState(enabled);
		persistSidebarVibrancy(enabled);
	}, []);

	return (
		<ColorSchemeContext
			value={{
				source,
				resolved,
				setSource,
				sidebarVibrancy,
				setSidebarVibrancy,
				appTheme,
				setAppTheme: applyAppTheme,
			}}
		>
			{children}
		</ColorSchemeContext>
	);
}

export function useColorScheme(): ColorSchemeContextValue {
	const value = use(ColorSchemeContext);
	if (!value) throw new Error("useColorScheme must be used within ThemeProvider.");
	return value;
}
