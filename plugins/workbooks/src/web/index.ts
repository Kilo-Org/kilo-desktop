import { definePlugin } from "@kilo-desktop/kernel";
import { ToolRenderer } from "@kilo-desktop/plugin-chat/contracts";
import {
	NewWorkSessionSettingPoint,
	WorkSessionAction,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { FilingReceipt } from "./FilingReceipt";
import { WorkbookChip } from "./WorkbookChip";
import { createWorkbookSelection } from "./workbook-selection";
import { workbookSetting } from "./WorkbookSetting";

/**
 * kilo.workbooks in each window: the Workbook setting in the New Session
 * page's location row, the open session's workbook chip and the workbook
 * tools' filing receipts in chats, all behind the `workbooks` flag.
 */
export const workbooksWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(
			NewWorkSessionSettingPoint,
			"workbook",
			workbookSetting(sdk, createWorkbookSelection()),
		);
		sdk.extensions.implement(WorkSessionAction, "workbook", WorkbookChip);
		sdk.extensions.implement(ToolRenderer, "receipts", { component: FilingReceipt });
	},
});
