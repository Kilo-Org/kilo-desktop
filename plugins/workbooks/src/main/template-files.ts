import { z } from "zod";

import type { WorkbookTemplateInput } from "../contracts";

/**
 * `workbook.json`: a template's manifest. Its pages and sections are data in
 * the manifest; only the guide (and any page's intro prose) live in files.
 */
const templateManifestSchema = z.object({
	schemaVersion: z.literal(2),
	id: z.string(),
	name: z.string(),
	description: z.string(),
	icon: z.string().optional(),
	guide: z.object({ file: z.string(), title: z.string() }),
	firstMove: z.string(),
	intake: z.array(z.unknown()),
	pages: z.array(
		z.looseObject({
			introFile: z.string().optional(),
		}),
	),
});

/**
 * Resolves a template folder (docs/workbooks/README.md) into one template:
 * `workbook.json` plus its files, keyed by their path relative to the folder.
 * Throws with every missing file named; the template's own rules are checked
 * afterwards against the template schema.
 */
export function templateFromFiles(
	manifest: unknown,
	files: Readonly<Record<string, string>>,
): WorkbookTemplateInput {
	const parsed = templateManifestSchema.parse(manifest);
	const referenced = [
		parsed.guide.file,
		...parsed.pages.flatMap((page) => (page.introFile ? [page.introFile] : [])),
	];
	const missing = referenced.filter((file) => files[file] === undefined);
	if (missing.length > 0) throw new Error(`missing template files: ${missing.join(", ")}`);
	return {
		id: parsed.id,
		name: parsed.name,
		description: parsed.description,
		...(parsed.icon ? { icon: parsed.icon } : {}),
		guide: { title: parsed.guide.title, markdown: files[parsed.guide.file]! },
		firstMove: parsed.firstMove,
		intake: parsed.intake as never,
		pages: parsed.pages.map(({ introFile, ...page }) => ({
			...page,
			...(introFile ? { intro: files[introFile]! } : {}),
		})) as never,
	};
}
