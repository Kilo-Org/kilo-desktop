import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
} from "@kilo-desktop/kernel";

/**
 * The section types every workbook template is built from (docs/workbooks):
 * like pre-printed stationery inserts, each comes finished, with its format,
 * rules, behaviour and starting content fixed by the app; its own default
 * title and label (what it collects); and its built-in instructions for
 * agents (`usage`). A template only picks section types, arranges them on
 * pages and, per section, may set its title, what it collects (`collects`)
 * and extra instructions for this kind of work (`instructions`). Every chat
 * is given each section's collects (what) and usage plus instructions (how).
 * Section types marked `single` appear at most once in a workbook.
 */
export const SECTION_CATALOGUE = {
	goal: {
		single: true,
		title: "Goal",
		collects: "What should be true when this is done, in the user's words.",
		usage:
			"Never rewrite it yourself: propose a change and write it only once the user confirms (write_section with userConfirmed).",
	},
	plan: {
		single: true,
		title: "Plan",
		collects:
			"The work, in order, each step sized for one chat; the checkboxes under it are its tasks, and jobs only the user can do are marked (you).",
		usage:
			"Mark a step in progress before starting it, tick its tasks as you go, and mark it done once they're all ticked, saying what it achieved (set_status). Re-cut the plan with edit_step, move_step, add_item and remove_item; steps renumber themselves.",
	},
	handoff: {
		single: true,
		title: "Where we left off",
		collects:
			"The latest handoff only: what was just done, what's next, any (you) tasks, and anything a fresh chat must know.",
		usage:
			"Before stopping, or when the context is running low, hand off (hand_off). It replaces the latest entry; every entry is also kept in the change log, when the workbook has one.",
	},
	activity: {
		single: true,
		title: "Who's working on what",
		collects:
			"Who is working in this workbook right now, and on what. Kept up to date by the workbook tools.",
		usage:
			"Kept up to date for you: starting a plan step puts you here, finishing it or handing off takes you off. When you're working on something that isn't a plan step, say what with set_activity, and clear it when you stop.",
	},
	"change-log": {
		single: true,
		title: "Change Log",
		collects: "Every handoff, newest first.",
		usage: "Filled by hand_off; don't add to it directly.",
	},
	todo: {
		single: false,
		title: "To do",
		collects: "Things to do, ticked when done.",
		usage: "Add items as they come up (add_item) and tick them when done (set_status).",
	},
	log: {
		single: false,
		title: "Log",
		collects: "Things worth keeping, as they come up.",
		usage:
			"Add an entry the moment something worth keeping comes up (add_item: text = a headline, detail = the rest). Never edit or delete an entry: supersede a wrong one (supersede), and record a reversal as a new entry that supersedes the old (add_item with supersedes).",
	},
	questions: {
		single: false,
		title: "Open questions",
		collects: "Things only the user can decide.",
		usage:
			"Put questions only the user can answer here, not only in the chat (add_item). When the user answers one, record the answer in a log and remove the question (answer_question with recordIn).",
	},
	notes: {
		single: false,
		title: "Notes",
		collects: "Anything worth writing down.",
		usage: "Keep it current: rewrite it as a whole when it changes (write_section).",
	},
	output: {
		single: false,
		title: "Result",
		collects: "What the work produces, organised as the finished thing should read.",
		usage:
			"Build the result here as the chat produces it, organised as the finished thing should read: add a new part (add_item: text = its title, detail = its content), improve the part something belongs to (write_section with part), or rewrite the whole when it needs reshaping (write_section). Never notes or drafts about the chat.",
	},
} as const satisfies Record<
	string,
	{ single: boolean; title: string; collects: string; usage: string }
>;

export const SECTION_TYPES = Object.keys(SECTION_CATALOGUE) as [
	keyof typeof SECTION_CATALOGUE,
	...(keyof typeof SECTION_CATALOGUE)[],
];
export type SectionType = keyof typeof SECTION_CATALOGUE;

/** How to work with a section: its type's instructions, then any its template adds. */
export function sectionUsage(section: {
	type: SectionType;
	instructions?: string | undefined;
}): string {
	const usage = SECTION_CATALOGUE[section.type].usage;
	return section.instructions ? `${usage} ${section.instructions}` : usage;
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
	type: z.enum(SECTION_TYPES),
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
	readonly type: SectionType;
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
 * its type.
 */
export function resolveSections(
	template: Pick<WorkbookTemplate, "pages">,
): { page: TemplatePage; sections: ResolvedSection[] }[] {
	return template.pages.map((page) => {
		const whole = !page.home && page.sections.length === 1;
		return {
			page,
			sections: page.sections.map((section) => {
				const printed = SECTION_CATALOGUE[section.type];
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
export function templateQuestions(template: Pick<WorkbookTemplate, "pages">): BriefField[] {
	const resolved = resolveSections(template);
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
		const all = resolveSections(template).flatMap((entry) => entry.sections);
		for (const id of repeated(all.map((section) => section.id))) {
			issue(`two sections would both be "${id}": give them different titles`);
		}
		for (const type of SECTION_TYPES) {
			if (
				SECTION_CATALOGUE[type].single &&
				all.filter((section) => section.type === type).length > 1
			) {
				issue(`only one section can be a ${type}`);
			}
		}
		if (!all.some((section) => section.type === "goal")) issue("a template needs a goal section");
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
