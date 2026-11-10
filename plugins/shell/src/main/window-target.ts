import {
	KernelError,
	KernelWindows,
	type DomainObjectCaller,
	type PluginSdk,
} from "@kilo-desktop/kernel";

export interface WindowTargetOptions {
	/** Windows whose frame reported where it is: kilo.shell is drawn there. */
	readonly frameWindows: () => readonly string[];
}

/**
 * Picks the window a navigation or notification request is for: the one it
 * names, else the caller's own (unless that is a secondary window, which has
 * no frame to apply it), else the main window. Without `kernel/windows`
 * (tests, browser mode) the first window with a frame stands in for the main
 * window.
 */
export function createWindowTarget(sdk: PluginSdk, options: WindowTargetOptions) {
	const windows = () => sdk.domainObjects.get(KernelWindows)?.getState().windows ?? {};
	const isSecondary = (windowId: string) => windows()[windowId]?.role === "secondary";
	const mainWindow = () =>
		Object.entries(windows()).find(([, window]) => window.role === "main")?.[0] ??
		options.frameWindows()[0];

	return (requested: string | undefined, caller: DomainObjectCaller): string => {
		if (requested) return requested;
		if (caller.windowId && !isSecondary(caller.windowId)) return caller.windowId;
		const target = mainWindow();
		if (!target) throw new KernelError("UNAVAILABLE", "No window is open to show this in.");
		return target;
	};
}
