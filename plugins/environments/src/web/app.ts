import { useCallback } from "react";

import { useDomain, useDomainState, useKernel } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";

/** Sends a declared telemetry event; never fails the caller. */
export function useTrack(): (event: string, data?: Record<string, unknown>) => void {
	const telemetry = useDomain(Telemetry);
	return useCallback(
		(event, data = {}) => void telemetry?.methods.track({ event, data }).catch(() => undefined),
		[telemetry],
	);
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
	const navigation = useDomain(Navigation);
	const selected = useDomainState(Navigation, (state) => state.search["env"] || undefined);
	const select = useCallback(
		(prefix: string | undefined) => {
			if (!navigation) return;
			const path = navigation.getState().path;
			void navigation.methods
				.navigate({ path, search: prefix ? { env: prefix } : {} })
				.catch(() => undefined);
		},
		[navigation],
	);
	return [selected, select] as const;
}

/** The local path of a dropped file; null where the window can't tell. */
export function usePathForFile(): (file: File) => string | null {
	const kernel = useKernel();
	return useCallback((file: File) => kernel.pathForFile(file), [kernel]);
}
