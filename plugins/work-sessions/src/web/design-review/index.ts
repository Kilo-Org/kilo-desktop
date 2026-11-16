import type { PluginSdk } from "@kilo-desktop/kernel";
import { StatusBarItem } from "@kilo-desktop/plugin-shell/contracts";

import { DesignReviewPanel } from "./DesignReviewPanel";

/** The dev build's design review panel, mounted through a status bar view that renders in place nothing. */
export function activateDesignReview(sdk: PluginSdk): void {
	sdk.extensions.implement(StatusBarItem, "design-review", {
		kind: "view",
		Component: DesignReviewPanel,
	});
}
