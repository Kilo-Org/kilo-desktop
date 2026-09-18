import type { DesktopApi } from "@kilo-desktop/contracts";

/** The preload bridge injected by the Electron shell, when running in Electron. */
export function getDesktopBridge(): DesktopApi | undefined {
	return (globalThis as { desktopApi?: DesktopApi }).desktopApi;
}

/** Whether the app runs inside the Electron shell (vs standalone browser). */
export function isDesktopBridgeAvailable(): boolean {
	return getDesktopBridge() !== undefined;
}
