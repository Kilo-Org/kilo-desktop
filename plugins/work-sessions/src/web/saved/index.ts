import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { countBucket } from "@kilo-desktop/ui/lib/reading/buckets";

import { SavedItems, WorkSessionsView, WorkSessionsWindow } from "../../contracts";
import { trackerFor } from "../shared/telemetry";
import { SAVED_VIEW_KEY, SavedView } from "./SavedView";

export { SAVED_VIEW_KEY } from "./SavedView";

export type SavedPageSource = "sidebar" | "toast-view" | "palette";

/** Shows the Saved page in this window and reports where it was opened from. */
export function showSavedPage(sdk: PluginSdk, source: SavedPageSource): void {
	const items = sdk.domainObjects.get(SavedItems)?.getState().items ?? [];
	trackerFor(sdk)("saved-page-opened", {
		source,
		itemCount: countBucket(items.length),
		sessionCount: countBucket(new Set(items.map((item) => item.workSessionId)).size),
	});
	void sdk.domainObjects
		.get(WorkSessionsWindow)
		?.methods.showView({ view: SAVED_VIEW_KEY })
		.catch(() => undefined);
}

/**
 * The Saved area: the Saved page as one of kilo.work-sessions' own work
 * sessions views (covering every workspace), opened from the session list's
 * "Saved" item, `show-saved` (the palette) or another plugin's toast
 * (`show-saved` with `{ source: "toast-view" }`).
 */
export function activateSaved(sdk: PluginSdk): void {
	sdk.extensions.implement(WorkSessionsView, "saved", { component: SavedView });
	sdk.extensions.implement(KernelCommand, "show-saved", (args) => {
		const source = (args as { source?: unknown } | undefined)?.source;
		showSavedPage(sdk, source === "toast-view" || source === "sidebar" ? source : "palette");
	});
}
