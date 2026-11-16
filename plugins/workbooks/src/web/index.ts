import { definePlugin } from "@kilo-desktop/kernel";
import { Dialog } from "@kilo-desktop/plugin-shell/contracts";
import { WorkSessionListAction } from "@kilo-desktop/plugin-work-sessions/contracts";

import { StartWorkbookDialog } from "./StartWorkbookDialog";
import { WorkbooksButton } from "./WorkbooksButton";

/**
 * kilo.workbooks in each window: starting a work session from a workbook (a
 * session-list button opening the "Start from a workbook" dialog), all behind
 * the `workbooks` flag.
 */
export const workbooksWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(WorkSessionListAction, "workbooks", WorkbooksButton);
		sdk.extensions.implement(Dialog, "start", StartWorkbookDialog);
	},
});
