import { KernelTelemetry } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

/** Sends a declared telemetry event (a `kernel/telemetry-event` id); never fails the caller. */
export function useTrack(): (event: string, data?: Record<string, unknown>) => void {
	const telemetry = useDomainObject(KernelTelemetry);
	return (event, data = {}) =>
		void telemetry?.methods.track({ event, data }).catch(() => undefined);
}

/**
 * The environment the settings page shows (`?env=<prefix>` on the window's
 * route), and a way to show another (`undefined` returns to the list). Going
 * through the router keeps back / forward working.
 */
export function useSelectedEnvironment(): readonly [
	string | undefined,
	(prefix: string | undefined) => void,
] {
	const windowId = useKernel().window.id;
	const navigation = useDomainObject(Navigation);
	const selected = useDomainObjectState(
		Navigation,
		(state) => state.windows[windowId]?.search["env"] || undefined,
	);
	const select = (prefix: string | undefined) => {
		const location = navigation?.getState().windows[windowId];
		if (!navigation || !location) return;
		void navigation.methods
			.navigate({ path: location.path, search: prefix ? { env: prefix } : {} })
			.catch(() => undefined);
	};
	return [selected, select] as const;
}

/** The local path of a dropped file; null where the window can't tell. */
export function usePathForFile(): (file: File) => string | null {
	const kernel = useKernel();
	return (file: File) => kernel.pathForFile(file);
}
