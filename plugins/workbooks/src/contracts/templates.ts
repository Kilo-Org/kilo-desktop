import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
} from "@kilo-desktop/kernel";

/**
 * The pre-printed sections ("inserts") every workbook template is built from
 * (docs/workbooks), like stationery inserts in a binder. Each insert has
 * how many a workbook may have, the rules a template may set on it, and its
 * own instructions for agents (`usage`): how to work with it,
 * whatever it's for. Some also have a purpose the app acts on: the goal is
 * shown everywhere, the plan gives progress and the next step, the handoff is
 * read first by every new chat. A template picks inserts, titles them and
 * says in its own words (`collects`) what belongs in each, so it can describe
 * any kind of work without new code; every chat is given each section's
 * `collects` (what) and its insert's `usage` (how).
 */
export const INSERTS = {
	goal: {
		rules: [],
		single: true,
		usage:
			"Never rewrite it yourself: propose a change and write it only once the user confirms (write_section with userConfirmed).",
	},
	plan: {
		rules: ["requires", "starter"],
		single: true,
		usage:
			"Mark a step in progress before starting it, tick its tasks as you go, and mark it done only once its rules are met (set_status says what's missing). Re-cut the plan with edit_step, move_step, add_item and remove_item; steps renumber themselves.",
	},
	handoff: {
		rules: ["history"],
		single: true,
		usage:
			"Before stopping, or when the context is running low, hand off (hand_off): what was done, what's next, any (you) tasks, anything a fresh chat must know. It replaces the latest entry; earlier ones are kept in its history.",
	},
	activity: {
		rules: [],
		single: true,
		usage:
			"Kept up to date for you: starting a plan step puts you here, finishing it or handing off takes you off. When you're working on something that isn't a plan step, say what with set_activity, and clear it when you stop.",
	},
	todo: {
		rules: [],
		single: false,
		usage: "Add items as they come up (add_item) and tick them when done (set_status).",
	},
	log: {
		rules: ["fields", "order"],
		single: false,
		usage:
			"Add an entry the moment something worth keeping comes up (add_item, with the section's fields). Never edit or delete an entry: supersede a wrong one (supersede), and record a reversal as a new entry that supersedes the old (add_item with supersedes).",
	},
	questions: {
		rules: ["answersTo"],
		single: false,
		usage:
			"Put questions only the user can answer here, not only in the chat (add_item). When the user answers one, record the answer and remove it (answer_question).",
	},
	notes: {
		rules: ["protected"],
		single: false,
		usage: "Keep it current: rewrite it as a whole when it changes (write_section).",
	},
	output: {
		rules: ["history"],
		single: false,
		usage:
			"Build the result here as the chat produces it, organised as the finished thing should read: add a new part (add_item: text = its title, detail = its content), improve the part something belongs to (write_section with part), or rewrite the whole when it needs reshaping (write_section). Never notes or drafts about the chat; say what changed.",
	},
} as const satisfies Record<
	string,
	{ rules: readonly SectionRule[]; single: boolean; usage: string }
>;

/** The rules a template may set on a section, each accepted by some inserts. */
export type SectionRule =
	| "requires"
	| "starter"
	| "fields"
	| "order"
	| "history"
	| "answersTo"
	| "protected";

/** The instructions for agents that come with an insert. */
export function insertUsage(type: SectionType): string {
	return INSERTS[type].usage;
}

/** How to work with a section: its insert's instructions, then any its template adds. */
export function sectionUsage(section: {
	type: SectionType;
	instructions?: string | undefined;
}): string {
	return section.instructions
		? `${insertUsage(section.type)} ${section.instructions}`
		: insertUsage(section.type);
}

const RULES: readonly SectionRule[] = [
	"requires",
	"starter",
	"fields",
	"order",
	"history",
	"answersTo",
	"protected",
];

export const SECTION_TYPES = Object.keys(INSERTS) as [
	keyof typeof INSERTS,
	...(keyof typeof INSERTS)[],
];
export type SectionType = keyof typeof INSERTS;

/** What a done step must have: its tasks ticked; a link to what it produced, or a reason there is none. */
export const STEP_REQUIREMENTS = ["tasks-ticked", "link-or-reason"] as const;

export const JOURNAL_ORDERS = ["oldest-first", "newest-first"] as const;

const slugSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, digits and dashes, starting with a letter");

/** A log field: a slug, ending in `?` when it may be left out. */
const journalFieldSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*\??$/, 'use a lowercase name, ending in "?" when optional');

const starterStepSchema = z.object({
	title: z.string().min(1),
	intent: z.string().min(1),
	tasks: z.array(z.string().min(1)).default([]),
});

/**
 * How a section behaves beyond its insert: what the tools check and keep.
 * Each rule belongs to some inserts; the template schema says which when a
 * template gets it wrong.
 */
export const sectionRulesSchema = z.object({
	/** What belongs here, in plain words: shown under its heading and given to agents. */
	collects: z.string().min(1).optional(),
	/**
	 * How to work with this section, added after its insert's own instructions:
	 * what this kind of work asks beyond the insert's defaults (the Coding
	 * template's plan: commit each step on its own).
	 */
	instructions: z.string().min(1).optional(),
	/** The line shown under its heading instead of `collects`. */
	note: z.string().min(1).optional(),
	/** plan: what a done step must have. */
	requires: z.array(z.enum(STEP_REQUIREMENTS)).optional(),
	/** log: the labelled fields each entry has besides its headline. */
	fields: z.array(journalFieldSchema).optional(),
	/** log: where new entries go. */
	order: z.enum(JOURNAL_ORDERS).optional(),
	/** handoff, output: the log that keeps every earlier handoff, or a note of each replaced version. */
	history: slugSchema.optional(),
	/** questions: the log an answer is recorded in. */
	answersTo: slugSchema.optional(),
	/** notes: agents may change it only with the user's say-so (the goal always is). */
	protected: z.boolean().optional(),
});
export type SectionRules = z.output<typeof sectionRulesSchema>;

/**
 * A section of a template page: one insert, under a `## <title>` heading,
 * or, untitled, the whole of a page that has no other section.
 */
export const templateSectionSchema = sectionRulesSchema.extend({
	id: slugSchema,
	title: z.string().min(1).optional(),
	type: z.enum(SECTION_TYPES),
	/** plan: the steps a new workbook starts with. */
	starter: z.array(starterStepSchema).optional(),
});
export type TemplateSection = z.output<typeof templateSectionSchema>;

/** A page of the workbook; the `home` page is the Project's own document (the Brief). */
export const templatePageSchema = z.object({
	id: slugSchema,
	title: z.string().min(1),
	home: z.boolean().default(false),
	/** Prose before its sections. */
	intro: z.string().optional(),
	sections: z.array(templateSectionSchema).default([]),
});
export type TemplatePage = z.output<typeof templatePageSchema>;

/** A question the New workbook wizard asks; the answer becomes the goal's or a notes section's content. */
export const intakeFieldSchema = z.object({
	fills: slugSchema,
	label: z.string().min(1),
	required: z.boolean().default(false),
	hint: z.string().optional(),
});
export type IntakeField = z.output<typeof intakeFieldSchema>;

/** Every section of a template, with the page it is on. */
export function templateSections(
	template: Pick<WorkbookTemplate, "pages">,
): { page: TemplatePage; section: TemplateSection }[] {
	return template.pages.flatMap((page) => page.sections.map((section) => ({ page, section })));
}

/** A workbook template with its content resolved: what creating a workbook copies. */
export const workbookTemplateSchema = z
	.object({
		id: slugSchema,
		name: z.string().min(1),
		description: z.string().min(1),
		icon: z.string().optional(),
		guide: z.object({ title: z.string().min(1), markdown: z.string().min(1) }),
		/** What the first agent in a new workbook does. */
		firstMove: z.string().min(1),
		intake: z.array(intakeFieldSchema).min(1),
		pages: z.array(templatePageSchema).min(1),
	})
	.superRefine((template, context) => {
		const issue = (message: string) => context.addIssue({ code: "custom", message });
		const repeated = (ids: readonly string[]) => [
			...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
		];
		const all = templateSections(template);
		const byId = new Map(all.map(({ section }) => [section.id, section]));

		for (const id of repeated(template.pages.map((page) => page.id))) {
			issue(`page "${id}" appears more than once`);
		}
		for (const id of repeated(all.map(({ section }) => section.id))) {
			issue(`section "${id}" appears more than once`);
		}
		for (const id of repeated(template.intake.map((field) => field.fills))) {
			issue(`intake field "${id}" appears more than once`);
		}
		if (template.pages.filter((page) => page.home).length !== 1) {
			issue("exactly one page must be the home page");
		}

		for (const { page, section } of all) {
			const name = `section "${section.id}"`;
			if (!section.title && (page.home || page.sections.length > 1)) {
				issue(
					`${name} needs a title: only the one section of a page other than home can be the whole page`,
				);
			}
			for (const rule of RULES) {
				const inserts = SECTION_TYPES.filter((type) =>
					(INSERTS[type].rules as readonly SectionRule[]).includes(rule),
				);
				if (section[rule] !== undefined && !inserts.includes(section.type)) {
					issue(`${name}: "${rule}" is for ${inserts.join(", ")} sections`);
				}
			}
			for (const rule of ["history", "answersTo"] as const) {
				const target = section[rule] ? byId.get(section[rule]) : undefined;
				if (section[rule] && target?.type !== "log") {
					issue(`${name}: its ${rule} "${section[rule]}" must be a log section`);
				}
			}
		}

		for (const [type, insert] of Object.entries(INSERTS)) {
			if (insert.single && all.filter(({ section }) => section.type === type).length > 1) {
				issue(`only one section can be a ${type}`);
			}
		}
		const goal = all.find(({ section }) => section.type === "goal")?.section;
		if (!goal) issue("a template needs a goal section");

		for (const field of template.intake) {
			const target = byId.get(field.fills);
			if (target?.type !== "goal" && target?.type !== "notes" && target?.type !== "output") {
				issue(`intake field "${field.fills}" must fill the goal, a notes or an output section`);
			}
		}
		if (goal && !template.intake.some((field) => field.fills === goal.id && field.required)) {
			issue("a required intake field must fill the goal");
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
