import { useEffect } from "react";

import type { IpcEventPayload } from "$shared";
import { invokeDesktop } from "@/lib/query/client";

type ThemeState = IpcEventPayload<"theme:changed">;

export function applyTheme(state: ThemeState): void {
	document.documentElement.classList.toggle("dark", state.shouldUseDarkColors);
	document.documentElement.style.colorScheme = state.shouldUseDarkColors ? "dark" : "light";
}

export function ThemeSync() {
	useEffect(() => {
		if (!window.desktopApi) return;

		let active = true;
		void invokeDesktop("theme:get").then((state) => {
			if (active) applyTheme(state);
		});
		const unsubscribe = window.desktopApi.on("theme:changed", applyTheme);

		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	return null;
}
