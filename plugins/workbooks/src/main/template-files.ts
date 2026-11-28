import { z } from "zod";

import type { WorkbookTemplateInput } from "../contracts";

/** The guide's file in a template folder. */
export const GUIDE_FILE = "AGENTS.md";

/** `workbook.json`: a template's manifest; its pages and sections are data, the guide a file. */
const templateManifestSchema = z.looseObject({
	schemaVersion: z.literal(3),
});

/**
 * Resolves a template folder (docs/workbooks/README.md) into one template:
 * `workbook.json` plus its guide (`AGENTS.md`). Throws when the guide is
 * missing or the manifest is another schema version; the template's own
 * rules are checked afterwards against the template schema.
 */
export function templateFromFiles(
	manifest: unknown,
	files: Readonly<Record<string, string>>,
): WorkbookTemplateInput {
	const { schemaVersion: _, ...template } = templateManifestSchema.parse(manifest);
	const guide = files[GUIDE_FILE];
	if (guide === undefined) throw new Error(`missing template file: ${GUIDE_FILE}`);
	return { ...(template as Omit<WorkbookTemplateInput, "guide">), guide };
}
