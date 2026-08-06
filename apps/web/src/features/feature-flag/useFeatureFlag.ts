import { useCallback, useSyncExternalStore } from "react";

import { useFeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

/**
 * Read a feature flag synchronously in the renderer, backed by the shell
 * feature-flags delegate. Returns `defaultValue` (or `false` when omitted)
 * until the host resolves the flag map, then re-renders with the real value —
 * mirroring how `useAuthSession` briefly reports `anonymous`.
 *
 * @example
 * const showNewEditor = useFeatureFlag("todos.newEditor");
 * const maxItems = useFeatureFlag("todos.maxItems", 100);
 */
export function useFeatureFlag<T = boolean>(key: string, defaultValue: T = false as T): T {
	const { featureFlags } = useFeatureSystem().services.shellDelegates;
	const getSnapshot = useCallback(
		() => (featureFlags.peek()[key] ?? defaultValue) as T,
		[featureFlags, key, defaultValue],
	);
	return useSyncExternalStore(featureFlags.subscribe, getSnapshot);
}
