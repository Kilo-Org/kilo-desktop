import type { PluginSdk } from "@kilo-desktop/kernel";

import { WorkSessionAction } from "../../contracts";
import { LayoutPresetsMenu } from "./LayoutPresetsMenu";

/**
 * The layouts area: the Layouts menu in an open work session's header
 * (`work-session-action` `layouts`, shown while `kernel/flag:chat-layouts`
 * is on), which saves, applies and defaults layout presets.
 */
export function activateLayouts(sdk: PluginSdk): void {
	if (sdk.context.get("kernel/secondaryWindow")) return;
	sdk.extensions.implement(WorkSessionAction, "layouts", LayoutPresetsMenu);
}
