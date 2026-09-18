/// <reference types="vite/client" />

import type { DesktopApi } from "@kilo-desktop/contracts";

declare global {
	interface Window {
		desktopApi?: DesktopApi;
	}
}

export {};
