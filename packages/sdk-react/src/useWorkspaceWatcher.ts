import { useEffect, useRef } from "react";

import isEqual from "lodash/isEqual.js";

import {
	createWorkspaceService,
	type WorkspaceFileChangeEvent,
	type WorkspaceFileChangeType,
	type WorkspaceSubscriptionOptions,
} from "@anaconda-agentic-desktop/feature-sdk";

import { useFeatureSystem } from "./SdkProvider.js";

export interface UseWorkspaceWatcherOptions {
	/** picomatch globs — if set, only matching paths fire. */
	includes?: string[];
	/** picomatch globs — matching paths are suppressed. */
	excludes?: string[];
	/** Event type filter — if set, only these event types fire. */
	types?: WorkspaceFileChangeType[];
	/** Called when matching file changes arrive. */
	onFileChange: (event: WorkspaceFileChangeEvent) => void;
	/** When false, the subscription is torn down. Defaults to true. */
	enabled?: boolean;
}

/**
 * Return a referentially stable copy of `value` that only changes identity
 * when the value is structurally different (lodash deep equality).
 */
function useStableValue<T>(value: T): T {
	const ref = useRef(value);
	if (!isEqual(ref.current, value)) {
		ref.current = value;
	}
	return ref.current;
}

/**
 * Subscribe to workspace file changes for the lifetime of the component.
 * Reads the feature system from React context — no SDK parameter needed.
 * Filters (picomatch include/exclude globs, event types) run per batch
 * inside the workspace service, so the callback only sees matching changes.
 *
 * `onFileChange` identity may change every render — the latest callback wins
 * without re-subscribing. Re-subscription happens only when the filter
 * options change (compared by deep equality, so inline array literals are
 * safe to pass) or when `enabled` toggles.
 *
 * @example
 * useWorkspaceWatcher({
 *   includes: ["src/**"],
 *   types: ["create", "update"],
 *   onFileChange: (event) => {
 *     if (event.root === directory) refresh();
 *   },
 *   enabled: isDirectorySelected,
 * });
 */
export function useWorkspaceWatcher(options: UseWorkspaceWatcherOptions): void {
	const { onFileChange, enabled = true } = options;
	const callbackRef = useRef(onFileChange);
	callbackRef.current = onFileChange;

	const system = useFeatureSystem();
	const filter = useStableValue<WorkspaceSubscriptionOptions>({
		includes: options.includes,
		excludes: options.excludes,
		types: options.types,
	});

	useEffect(() => {
		if (!enabled) return;
		// The hook is feature-agnostic (no featureId), so it binds directly to
		// the raw event bus. The effect cleanup owns unsubscription; the bus is
		// inert after FeatureSystem.dispose() detaches its transport.
		const workspace = createWorkspaceService(system.services.featureRouter.eventBus);
		return workspace.subscribe(filter, (event) => callbackRef.current(event));
	}, [system, filter, enabled]);
}
