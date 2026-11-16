import { definePlugin } from "@kilo-desktop/kernel";

import { WorkbookTemplatePoint } from "../contracts";
import { BUILT_IN_TEMPLATES } from "./built-in-templates";
import { provideTemplates } from "./template-registry";

/**
 * kilo.workbooks in main: the workbook templates on offer (its built-ins
 * shipped through its own `template` point), and later each workspace's
 * workbook references and the workbook agent tools.
 */
export const workbooksMainEntry = definePlugin({
	activate(sdk) {
		for (const [id, read] of Object.entries(BUILT_IN_TEMPLATES)) {
			sdk.extensions.implement(WorkbookTemplatePoint, id, { read });
		}
		provideTemplates(sdk);
	},
});
