import { definePlugin } from "@kilo-desktop/kernel";
import { ToolRenderer } from "@kilo-desktop/plugin-chat/contracts";
import { Dialog } from "@kilo-desktop/plugin-shell/contracts";
import {
	WorkSessionAction,
	WorkSessionListAction,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { FilingReceipt } from "./FilingReceipt";
import { WorkbookChip } from "./WorkbookChip";
import { StartWorkbookDialog } from "./StartWorkbookDialog";
import { WorkbooksButton } from "./WorkbooksButton";

/**
 * kilo.workbooks in each window: starting a work session from a workbook (a
 * session-list button opening the "Start from a workbook" dialog), the open
 * session's workbook chip and the workbook tools' filing receipts in chats,
 * all behind the `workbooks` flag.
 */
export const workbooksWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(WorkSessionListAction, "workbooks", WorkbooksButton);
		sdk.extensions.implement(Dialog, "start", StartWorkbookDialog);
		sdk.extensions.implement(WorkSessionAction, "workbook", WorkbookChip);
		sdk.extensions.implement(ToolRenderer, "receipts", { component: FilingReceipt });
	},
});
