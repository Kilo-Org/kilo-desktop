import {
	KernelError,
	KernelWindows,
	type DomainObjectCaller,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import { Navigation, SHELL_PLUGIN_ID } from "../contracts";
import { createWindowTarget } from "./window-target";

export interface NavigationOptions {
	/** A window reported a path other than the one it was on. */
	readonly onPathChanged?: (windowId: string, path: string) => void;
}

/**
 * Navigation lives in main so any process can move any window: requests
 * resolve their target window (see `createWindowTarget`) and are announced as
 * `navigate-requested` / `dialog-requested`, which that window's frame
 * applies. The state is where each frame says it is (`reportLocation`, from
 * kilo.shell's own windows only); a window's entry goes when it closes.
 */
export function provideNavigation(sdk: PluginSdk, options: NavigationOptions = {}): void {
	const target = createWindowTarget(sdk, {
		frameWindows: () => Object.keys(navigation.state.windows),
	});
	const requestPath = (
		path: string,
		search: Record<string, string>,
		windowId: string | undefined,
		caller: DomainObjectCaller,
	) => {
		navigation.emit("navigate-requested", { windowId: target(windowId, caller), path, search });
	};

	const navigation: DomainObjectProvider<typeof Navigation> = sdk.domainObjects.provide(
		Navigation,
		{
			initialState: { windows: {} },
			methods: {
				navigate: ({ path, search, windowId }, caller) =>
					requestPath(path, search ?? {}, windowId, caller),
				openSettings: ({ section, windowId }, caller) =>
					requestPath(settingsPath(section), {}, windowId, caller),
				goHome: ({ windowId }, caller) => requestPath("/", {}, windowId, caller),
				openDialog: ({ dialog, input, windowId }, caller) => {
					navigation.emit("dialog-requested", {
						windowId: target(windowId, caller),
						dialog,
						...(input === undefined ? {} : { input }),
					});
				},
				reportLocation: (location, caller) => {
					const windowId = reportingWindow(caller);
					const previous = navigation.state.windows[windowId];
					navigation.setState({ windows: { ...navigation.state.windows, [windowId]: location } });
					if (previous?.path !== location.path) options.onPathChanged?.(windowId, location.path);
				},
			},
		},
	);

	const forget = (windowId: string) => {
		const { [windowId]: _closed, ...rest } = navigation.state.windows;
		if (_closed) navigation.setState({ windows: rest });
	};
	let stopListening: (() => void) | undefined;
	sdk.domainObjects.track(KernelWindows, {
		added: (windows) => {
			stopListening = windows.on("closed", ({ windowId }) => forget(windowId));
		},
		removed: () => {
			stopListening?.();
			stopListening = undefined;
		},
	});
	sdk.onDispose(() => stopListening?.());
}

/**
 * Settings pages sit at `/settings/<id>`: a section named by its contribution
 * key (`kilo.shell/account`) or by its id (`account`) opens the same page.
 */
export function settingsPath(section: string | undefined): string {
	if (!section) return "/settings";
	const slash = section.indexOf("/");
	return `/settings/${slash === -1 ? section : section.slice(slash + 1)}`;
}

function reportingWindow(caller: DomainObjectCaller): string {
	if (caller.pluginId !== SHELL_PLUGIN_ID || caller.process !== "renderer" || !caller.windowId) {
		throw new KernelError("PERMISSION_DENIED", "Only kilo.shell's windows report where they are.");
	}
	return caller.windowId;
}
