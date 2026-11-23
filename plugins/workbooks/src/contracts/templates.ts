import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	implementation,
	method,
} from "@kilo-desktop/kernel";

/**
 * The shared vocabulary every workbook template is built from
 * (docs/workbooks). A section's type says how its items are written and how
 * they change; its role, when it has one, says what the app does with it. A
 * template picks from these; its own words (`collects`) say what belongs in
 * each section, so it can describe any kind of work without new code.
 */
export const SECTION_TYPES = ["steps", "checklist", "journal", "questions", "text"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** What the app does with a section: shows the goal, tracks the plan, hands off between chats. */
export const SECTION_ROLES = ["goal", "plan", "handoff"] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

/** The section type each role implies. */
export const ROLE_TYPES: Readonly<Record<SectionRole, SectionType>> = {
	goal: "text",
	plan: "steps",
	handoff: "journal",
};

/** What a done step must have: its tasks ticked; a link (commit, PR) or a reason there is none. */
export const STEP_REQUIREMENTS = ["tasks-ticked", "link-or-reason"] as const;

export const JOURNAL_ORDERS = ["oldest-first", "newest-first"] as const;

const slugSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, digits and dashes, starting with a letter");

/** A journal field: a slug, ending in `?` when it may be left out. */
const journalFieldSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]*\??$/, 'use a lowercase name, ending in "?" when optional');

const starterStepSchema = z.object({
	title: z.string().min(1),
	intent: z.string().min(1),
	tasks: z.array(z.string().min(1)).default([]),
});

/**
 * How a section behaves, beyond its type: what the tools check and keep.
 * Each rule belongs to one section type (or role); the template schema says
 * which when a template gets it wrong.
 */
export const sectionRulesSchema = z.object({
	/** What belongs here, in plain words: shown under its heading and given to agents. */
	collects: z.string().min(1).optional(),
	/** The line shown under its heading instead of `collects`. */
	note: z.string().min(1).optional(),
	/** steps: what a done step must have. */
	requires: z.array(z.enum(STEP_REQUIREMENTS)).optional(),
	/** journal: the labelled fields each entry has besides its headline. */
	fields: z.array(journalFieldSchema).optional(),
	/** journal: where new entries go. */
	order: z.enum(JOURNAL_ORDERS).optional(),
	/** handoff: the journal that keeps every earlier handoff. */
	history: slugSchema.optional(),
	/** text: agents may change it only with the user's say-so (the goal always is). */
	protected: z.boolean().optional(),
});
export type SectionRules = z.output<typeof sectionRulesSchema>;

/**
 * A section of a template page: a `## <title>` heading and what is under it,
 * or, untitled, the whole of a page that has no other section. It has a type,
 * or a role that implies one.
 */
export const templateSectionSchema = sectionRulesSchema.extend({
	id: slugSchema,
	title: z.string().min(1).optional(),
	type: z.enum(SECTION_TYPES).optional(),
	role: z.enum(SECTION_ROLES).optional(),
	/** steps: the steps a new workbook starts with. */
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

/** A question the New workbook wizard asks; the answer becomes a text section's content. */
export const intakeFieldSchema = z.object({
	fills: slugSchema,
	label: z.string().min(1),
	required: z.boolean().default(false),
	hint: z.string().optional(),
});
export type IntakeField = z.output<typeof intakeFieldSchema>;

/** A section's type, stated or implied by its role. */
export function sectionType(section: Pick<TemplateSection, "type" | "role">): SectionType {
	return section.type ?? ROLE_TYPES[section.role!];
}

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
			if (!section.type && !section.role) issue(`${name} needs a type or a role`);
			if (section.type && section.role && section.type !== ROLE_TYPES[section.role]) {
				issue(`${name}: the ${section.role} role is a ${ROLE_TYPES[section.role]} section`);
			}
			if (!section.title && (page.home || page.sections.length > 1)) {
				issue(
					`${name} needs a title: only the one section of a page other than home can be the whole page`,
				);
			}
			if (!section.type && !section.role) continue;
			const type = sectionType(section);
			const only = (rule: keyof TemplateSection, types: SectionType) => {
				if (section[rule] !== undefined && type !== types) {
					issue(`${name}: "${rule}" is for ${types} sections`);
				}
			};
			only("requires", "steps");
			only("starter", "steps");
			only("fields", "journal");
			only("order", "journal");
			only("protected", "text");
			if (section.history !== undefined) {
				const target = byId.get(section.history);
				if (section.role !== "handoff") issue(`${name}: "history" is for the handoff section`);
				else if (!target || (target.type ?? ROLE_TYPES[target.role!]) !== "journal") {
					issue(`${name}: its history "${section.history}" must be a journal section`);
				}
			}
		}

		for (const role of new Set(
			all.flatMap(({ section }) => (section.role ? [section.role] : [])),
		)) {
			if (all.filter(({ section }) => section.role === role).length > 1) {
				issue(`only one section can have the ${role} role`);
			}
		}
		const goal = all.find(({ section }) => section.role === "goal")?.section;
		if (!goal) issue("a section needs the goal role");

		for (const field of template.intake) {
			const target = byId.get(field.fills);
			if (!target || (target.type ?? (target.role && ROLE_TYPES[target.role])) !== "text") {
				issue(`intake field "${field.fills}" must fill a text section`);
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
