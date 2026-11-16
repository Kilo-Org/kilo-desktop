import { definePlugin } from "@kilo-desktop/kernel";
import { ToolRenderer } from "@kilo-desktop/plugin-chat/contracts";
import {
	NewWorkSessionSection,
	WorkSessionAction,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { FilingReceipt } from "./FilingReceipt";
import { WorkbookChip } from "./WorkbookChip";
import { WorkbooksSection } from "./WorkbooksSection";

/**
 * kilo.workbooks in each window: "Start from a workbook" on the New Session
 * page, the open session's workbook chip and the workbook tools' filing
 * receipts in chats, all behind the `workbooks` flag.
 */
export const workbooksWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(NewWorkSessionSection, "workbooks", WorkbooksSection);
		sdk.extensions.implement(WorkSessionAction, "workbook", WorkbookChip);
		sdk.extensions.implement(ToolRenderer, "receipts", { component: FilingReceipt });
	},
});
