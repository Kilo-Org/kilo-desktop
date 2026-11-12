import type { PluginSdk } from "@kilo-desktop/kernel";

import { AboutSection, SidebarNotice } from "../../contracts";
import { AboutLegalSection } from "./AboutLegalSection";
import { AboutVersionSection } from "./AboutVersionSection";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

/**
 * The updates area: the version and legal blocks of About and the sidebar's
 * update notice (`update-ready`: restart into a downloaded update, or, where
 * the app can't install updates itself, an available one to download).
 */
export function activateUpdates(sdk: PluginSdk): void {
	sdk.extensions.implement(AboutSection, "version", AboutVersionSection);
	sdk.extensions.implement(AboutSection, "legal", AboutLegalSection);
	sdk.extensions.implement(SidebarNotice, "update-ready", SidebarUpdatePill);
}
