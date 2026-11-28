import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
} from "@kilo-desktop/kernel";

import type { SectionTypeFacts } from "./section-types";

/** How to work with a section: its type's instructions, then any its template adds. */
export function sectionUsage(type: { readonly usage: string }, instructions?: string): string {
	return instructions ? `${type.usage} ${instructions}` : type.usage;
}

/** What the first chat in a new workbook does, whatever its template. */
export const FIRST_MOVE =
	"Refine the Brief (ask about anything missing), then draft the Plan, and stop for the user to confirm it before starting.";

const slugSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, digits and dashes, starting with a letter");

const slug = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^(\d)/, "s-$1") || "section";

/** A section of a template page: a section type, and optionally the words that make it this template's. */
export const templateSectionSchema = z.strictObject({
	/** A section type's id (`kilo.workbooks/section-type`). */
	type: slugSchema,
	/** Its heading; defaults to the section type's own. */
	title: z.string().min(1).optional(),
	/** What belongs in it, in plain words; defaults to the section type's label. */
	collects: z.string().min(1).optional(),
	/** How to work with it in this kind of work, added after the section type's own instructions. */
	instructions: z.string().min(1).optional(),
});
export type TemplateSection = z.output<typeof templateSectionSchema>;

/** A page of the workbook; the `home` page is the Project's own document (the Brief). */
export const templatePageSchema = z.strictObject({
	title: z.string().min(1),
	home: z.boolean().default(false),
	sections: z.array(templateSectionSchema).min(1),
});
export type TemplatePage = z.output<typeof templatePageSchema>;

/**
 * A template section as a workbook has it: a stable id, the heading it lives
 * under (none when it is the whole of a page other than home), and its
 * words with the section type's defaults filled in.
 */
export interface ResolvedSection {
	readonly id: string;
	readonly type: string;
	readonly title: string;
	readonly heading: string | undefined;
	readonly collects: string;
	readonly instructions?: string;
}

/**
 * Every section of a template, page by page, resolved. A page other than
 * home with a single section is that section (no heading). A section's id is
 * its type for a section type a workbook has once (goal, plan…); otherwise its
 * title's slug when it has a title, the page's when it is the whole page, or
 * its type. A type nobody offers resolves with its id as its title.
 */
export function resolveSections(
	template: Pick<WorkbookTemplate, "pages">,
	types: SectionTypeLookup,
): { page: TemplatePage; sections: ResolvedSection[] }[] {
	return template.pages.map((page) => {
		const whole = !page.home && page.sections.length === 1;
		return {
			page,
			sections: page.sections.map((section) => {
				const printed = types(section.type) ?? { single: false, title: section.type, collects: "" };
				const title = section.title ?? (whole ? page.title : printed.title);
				const id = printed.single
					? section.type
					: section.title
						? slug(section.title)
						: whole
							? slug(page.title)
							: section.type;
				return {
					id,
					type: section.type,
					title,
					heading: whole ? undefined : title,
					collects: section.collects ?? printed.collects,
					...(section.instructions ? { instructions: section.instructions } : {}),
				};
			}),
		};
	});
}

/** The wizard's questions: the goal (required), and context for the Brief's first notes section. */
export function templateQuestions(
	template: Pick<WorkbookTemplate, "pages">,
	types: SectionTypeLookup,
): BriefField[] {
	const resolved = resolveSections(template, types);
	const all = resolved.flatMap((entry) => entry.sections);
	const goal = all.find((section) => section.type === "goal");
	const context = resolved
		.find((entry) => entry.page.home)
		?.sections.find((section) => section.type === "notes");
	return [
		...(goal ? [{ id: goal.id, label: goal.title, required: true, hint: goal.collects }] : []),
		...(context
			? [{ id: context.id, label: context.title, required: false, hint: context.collects }]
			: []),
	];
}

/** A workbook template: section types arranged on pages, plus a guide. */
export const workbookTemplateSchema = z
	.strictObject({
		id: slugSchema,
		name: z.string().min(1),
		description: z.string().min(1),
		icon: z.string().optional(),
		/** The agent guide ("How to work here"): behaviour specific to this kind of work. */
		guide: z.string().min(1),
		pages: z.array(templatePageSchema).min(1),
	})
	.superRefine((template, context) => {
		const issue = (message: string) => context.addIssue({ code: "custom", message });
		const repeated = (ids: readonly string[]) => [
			...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
		];
		if (template.pages.filter((page) => page.home).length !== 1) {
			issue("exactly one page must be the home page");
		}
		for (const title of repeated(template.pages.map((page) => page.title.toLowerCase()))) {
			issue(`two pages are titled "${title}"`);
		}
	});
export type WorkbookTemplate = z.output<typeof workbookTemplateSchema>;
export type WorkbookTemplateInput = z.input<typeof workbookTemplateSchema>;

/** The section types on offer, by id. */
export type SectionTypeLookup = (type: string) => SectionTypeFacts | undefined;

/**
 * What's wrong with a template given the section types on offer: types
 * nobody offers, a one-per-workbook type used twice, two sections that would
 * share an id, or no goal. Empty when it can be used.
 */
export function templateIssues(template: WorkbookTemplate, types: SectionTypeLookup): string[] {
	const issues: string[] = [];
	const used = template.pages.flatMap((page) => page.sections.map((section) => section.type));
	for (const type of new Set(used)) {
		if (!types(type)) issues.push(`needs section type "${type}", which isn't installed`);
		else if (types(type)!.single && used.filter((candidate) => candidate === type).length > 1) {
			issues.push(`only one section can be a ${type}`);
		}
	}
	const ids = resolveSections(template, types).flatMap((entry) =>
		entry.sections.map((section) => section.id),
	);
	for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
		issues.push(`two sections would both be "${id}": give them different titles`);
	}
	if (!used.includes("goal")) issues.push("a template needs a goal section");
	return issues;
}

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

/** A question the New workbook wizard asks, keyed by the section it fills. */
export const briefFieldSchema = z.object({
	id: z.string(),
	label: z.string(),
	required: z.boolean(),
	hint: z.string().optional(),
});
export type BriefField = z.output<typeof briefFieldSchema>;

export const templateSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	icon: z.string().optional(),
	/** The wizard's questions: the template's intake, by the section each fills. */
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
