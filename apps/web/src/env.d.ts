/// <reference types="vite/client" />

import type { DesktopApi } from "@anaconda-agentic-desktop/contracts";

declare global {
	interface Window {
		desktopApi?: DesktopApi;
	}
}

export {};
