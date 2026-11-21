import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
} from "@kilo-desktop/kernel";

/**
 * The shared vocabulary every workbook template is built from. A section holds
 * one item type; the app and the workbook tools address sections by id and
 * item type, never by title.
 */
export const ITEM_TYPES = [
	"plan-step",
	"task",
	"decision",
	"finding",
	"question",
	"reference",
	"artifact",
	"note",
	/** A dated "where I left off" entry, newest first; the latest is also in the Brief. */
	"log-entry",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

const slugSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, digits and dashes, starting with a letter");

export const briefFieldSchema = z.object({
	id: slugSchema,
	label: z.string().min(1),
	required: z.boolean().default(false),
	hint: z.string().optional(),
});
export type BriefField = z.output<typeof briefFieldSchema>;

/** Where a section lives when it isn't a page of its own: the Brief, or a template page by id. */
export const BRIEF_PAGE = "brief";

/**
 * A section: a page of its own (with `markdown`), or the part of a shared
 * page under a `## <title>` heading (`in`: a page id from `pages`, or
 * "brief" for the Brief), so related sections can share one page.
 */
export const templateSectionSchema = z.object({
	id: slugSchema,
	title: z.string().min(1),
	itemType: z.enum(ITEM_TYPES),
	in: slugSchema.optional(),
	/** Starter content of a section that is its own page: one line on what belongs there. */
	markdown: z.string().optional(),
});
export type TemplateSection = z.output<typeof templateSectionSchema>;

/** A page that holds several sections, each under its own heading. */
export const templatePageSchema = z.object({
	id: slugSchema,
	title: z.string().min(1),
	/** Its starter content, with a `## <title>` heading for each section in it. */
	markdown: z.string(),
});
export type TemplatePage = z.output<typeof templatePageSchema>;

/** Whether `markdown` has a heading reading `title` (any level, ignoring case). */
export function hasHeading(markdown: string, title: string): boolean {
	const wanted = title.trim().toLowerCase();
	return markdown.split("\n").some(
		(line) =>
			/^#{1,6} /.test(line) &&
			line
				.replace(/^#{1,6} /, "")
				.trim()
				.toLowerCase() === wanted,
	);
}

/** A workbook template with its content resolved: what creating a workbook copies. */
export const workbookTemplateSchema = z
	.object({
		id: slugSchema,
		name: z.string().min(1),
		description: z.string().min(1),
		icon: z.string().optional(),
		brief: z.object({
			/** The Brief, with `{{field}}` placeholders for its fields (and `{{status}}`). */
			markdown: z.string(),
			fields: z.array(briefFieldSchema).min(1),
		}),
		guide: z.object({ title: z.string().min(1), markdown: z.string().min(1) }),
		/** What the first agent in a new workbook does. */
		firstMove: z.string().min(1),
		/** Pages holding several sections; sections name theirs with `in`. */
		pages: z.array(templatePageSchema).default([]),
		sections: z.array(templateSectionSchema).min(1),
	})
	.superRefine((template, context) => {
		const repeated = (ids: readonly string[]) =>
			ids.filter((id, index) => ids.indexOf(id) !== index);
		for (const id of repeated(template.sections.map((section) => section.id))) {
			context.addIssue({ code: "custom", message: `section "${id}" appears more than once` });
		}
		for (const id of repeated(template.brief.fields.map((field) => field.id))) {
			context.addIssue({ code: "custom", message: `Brief field "${id}" appears more than once` });
		}
		for (const id of repeated(template.pages.map((page) => page.id))) {
			context.addIssue({ code: "custom", message: `page "${id}" appears more than once` });
		}
		const pageMarkdown = new Map(template.pages.map((page) => [page.id, page.markdown]));
		for (const section of template.sections) {
			if (section.in === undefined) {
				if (section.markdown === undefined) {
					context.addIssue({
						code: "custom",
						message: `section "${section.id}" needs markdown, or a page to live in`,
					});
				}
				continue;
			}
			const holder =
				section.in === BRIEF_PAGE ? template.brief.markdown : pageMarkdown.get(section.in);
			if (holder === undefined) {
				context.addIssue({
					code: "custom",
					message: `section "${section.id}" is in page "${section.in}", which the template doesn't have`,
				});
			} else if (!hasHeading(holder, section.title)) {
				context.addIssue({
					code: "custom",
					message: `section "${section.id}" needs a "${section.title}" heading in "${section.in}"`,
				});
			}
		}
		if (!template.brief.fields.some((field) => field.required)) {
			context.addIssue({ code: "custom", message: "the Brief needs at least one required field" });
		}
	});
export type WorkbookTemplate = z.output<typeof workbookTemplateSchema>;
export type WorkbookTemplateInput = z.input<typeof workbookTemplateSchema>;

/** What a `template` contribution implements, in main: its template, validated by kilo.workbooks. */
export interface WorkbookTemplateSource {
	read(): unknown;
}

/**
 * A workbook template offered when creating a workbook. kilo.workbooks ships
 * its built-ins (Coding) through this point; templates that fail validation,
 * or repeat an id already taken by a higher-priority contribution, are skipped
 * and reported in `kilo.workbooks/templates`.
 */
export const WorkbookTemplatePoint = defineExtensionPoint({
	id: "kilo.workbooks/template",
	kind: "additive",
	description: "A workbook template offered when creating a workbook.",
	implementation: implementation<WorkbookTemplateSource>("main"),
});

export const templateSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	icon: z.string().optional(),
	fields: z.array(briefFieldSchema),
	/** What the first chat in a new workbook does. */
	firstMove: z.string(),
	/** The contribution that provides it, e.g. `kilo.workbooks/coding`. */
	source: z.string(),
});
export type TemplateSummary = z.output<typeof templateSummarySchema>;

/** The workbook templates on offer, from every `template` contribution. */
export const WorkbookTemplates = defineDomainObject({
	id: "kilo.workbooks/templates",
	home: "main",
	state: z.object({
		templates: z.array(templateSummarySchema),
		/** Contributions that were skipped, and why. */
		issues: z.array(z.object({ source: z.string(), message: z.string() })),
	}),
	methods: {
		/** The whole template; NOT_FOUND when no contribution offers `id`. */
		get: method(z.object({ id: z.string() }), workbookTemplateSchema),
	},
});
