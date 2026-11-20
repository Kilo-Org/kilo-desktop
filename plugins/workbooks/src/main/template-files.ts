import { z } from "zod";

import type { WorkbookTemplateInput } from "../contracts";

/** `workbook.json`: a template's manifest, whose content lives in sibling files. */
const templateManifestSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	name: z.string(),
	description: z.string(),
	icon: z.string().optional(),
	brief: z.object({ file: z.string(), fields: z.array(z.unknown()) }),
	guide: z.object({ file: z.string(), title: z.string() }),
	firstMove: z.string(),
	pages: z.array(z.object({ id: z.string(), title: z.string(), file: z.string() })).default([]),
	sections: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			itemType: z.string(),
			/** A page id from `pages`, or "brief"; the section is the part under its heading there. */
			in: z.string().optional(),
			file: z.string().optional(),
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
		parsed.brief.file,
		parsed.guide.file,
		...parsed.pages.map((page) => page.file),
		...parsed.sections.flatMap((section) => (section.file ? [section.file] : [])),
	];
	const missing = referenced.filter((file) => files[file] === undefined);
	if (missing.length > 0) throw new Error(`missing template files: ${missing.join(", ")}`);
	const read = (file: string) => files[file]!;
	return {
		id: parsed.id,
		name: parsed.name,
		description: parsed.description,
		...(parsed.icon ? { icon: parsed.icon } : {}),
		brief: { markdown: read(parsed.brief.file), fields: parsed.brief.fields as never },
		guide: { title: parsed.guide.title, markdown: read(parsed.guide.file) },
		firstMove: parsed.firstMove,
		pages: parsed.pages.map((page) => ({
			id: page.id,
			title: page.title,
			markdown: read(page.file),
		})),
		sections: parsed.sections.map((section) => ({
			id: section.id,
			title: section.title,
			itemType: section.itemType as never,
			...(section.in ? { in: section.in } : {}),
			...(section.file ? { markdown: read(section.file) } : {}),
		})),
	};
}
