import { setMode } from "mode-watcher";

import type { IpcEventPayload } from "$shared";

import { invokeDesktop } from "$lib/query/client.js";

type ThemeStateValue = IpcEventPayload<"theme:changed">;
type Mode = ThemeStateValue["source"];

export class ThemeState {
	source = $state<Mode>("system");
	shouldUseDarkColors = $state(false);
	#unsubscribe: (() => void) | undefined;

	async initialize(): Promise<void> {
		if (typeof window === "undefined" || !window.desktopApi) return;
		this.#apply(await invokeDesktop("theme:get"));
		this.#unsubscribe = window.desktopApi.on("theme:changed", (state) => {
			this.#apply(state);
		});
	}

	async setSource(source: Mode): Promise<void> {
		this.#apply(await invokeDesktop("theme:set", { source }));
	}

	destroy(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
	}

	#apply(state: ThemeStateValue): void {
		this.source = state.source;
		this.shouldUseDarkColors = state.shouldUseDarkColors;
		setMode(state.source);
	}
}
