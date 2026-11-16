import { definePlugin } from "@kilo-desktop/kernel";

/**
 * kilo.workbooks in main. Will own the workbook templates, each workspace's
 * workbook references and the workbook agent tools; empty until those arrive.
 */
export const workbooksMainEntry = definePlugin({
	activate() {},
});
