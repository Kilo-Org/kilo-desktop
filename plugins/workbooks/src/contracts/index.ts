import type { PluginDefinitions } from "@kilo-desktop/kernel";

import { WorkbookTemplatePoint, WorkbookTemplates } from "./templates";

export * from "./templates";

/**
 * kilo.workbooks' public surface. A workbook keeps what chats learn and decide
 * about a piece of work, outside any one chat, for the person and several
 * agents; it is created from a workbook template (docs/workbooks).
 */
export const WORKBOOKS_PLUGIN_ID = "kilo.workbooks";

/** The flag every workbook surface sits behind while the feature is a prototype. */
export const WORKBOOKS_FEATURE_FLAG = "workbooks";

/** What the kernel needs to know about this plugin without running it. */
export const WORKBOOKS_DEFINITIONS: PluginDefinitions = {
	domainObjects: [WorkbookTemplates],
	extensionPoints: [WorkbookTemplatePoint],
};
