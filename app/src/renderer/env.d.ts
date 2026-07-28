/// <reference types="vite/client" />

import type { DesktopApi } from "$shared";

declare global {
	interface Window {
		desktopApi: DesktopApi;
	}
}

export {};
