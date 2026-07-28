import { nativeTheme, type NativeTheme } from "electron";

import type { IpcEventPayload } from "@anaconda-agentic-desktop/contracts";

export type DesktopThemeState = IpcEventPayload<"theme:changed">;
export type DesktopThemeSource = DesktopThemeState["source"];

export class ElectronTheme {
	constructor(private readonly theme: NativeTheme = nativeTheme) {}

	get state(): DesktopThemeState {
		return {
			source: this.theme.themeSource,
			shouldUseDarkColors: this.theme.shouldUseDarkColors,
		};
	}

	setSource(source: DesktopThemeSource): DesktopThemeState {
		this.theme.themeSource = source;
		return this.state;
	}

	onUpdated(listener: (state: DesktopThemeState) => void): () => void {
		const handler = () => listener(this.state);
		this.theme.on("updated", handler);
		return () => {
			this.theme.removeListener("updated", handler);
		};
	}
}
