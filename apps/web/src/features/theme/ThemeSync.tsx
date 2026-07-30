import { useEffect } from "react";

import type { ThemeState } from "@anaconda-agentic-desktop/contracts";

import { useLocalApi } from "@/platform/LocalApiProvider";

export function applyTheme(state: ThemeState): void {
	const root = document.documentElement;
	root.classList.toggle("dark", state.shouldUseDarkColors);
	if (state.shouldUseDarkColors) {
		root.dataset.theme = "dark";
	} else {
		delete root.dataset.theme;
	}
	root.style.colorScheme = state.shouldUseDarkColors ? "dark" : "light";
}

export function ThemeSync() {
	const api = useLocalApi();

	useEffect(() => {
		let active = true;
		void api.theme.get().then((state) => {
			if (active) applyTheme(state);
		});
		const unsubscribe = api.theme.onChanged(applyTheme);

		return () => {
			active = false;
			unsubscribe();
		};
	}, [api]);

	return null;
}
