import { z } from "zod";

import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { defineTool, Tool } from "@kilo-desktop/plugin-core/contracts";

import { SECTION_CATALOGUE, SECTION_TYPES, type WorkbookTemplate } from "../contracts";
import type { UserTemplates } from "./user-templates";

export const TEMPLATE_TOOL_IDS = ["read_templates", "save_template", "delete_template"] as const;

export interface TemplateToolDeps {
	readonly user: UserTemplates;
	readonly find: (id: string) => WorkbookTemplate | undefined;
	readonly all: () => WorkbookTemplate[];
	readonly contributedIds: () => ReadonlySet<string>;
	readonly reread: () => void;
}

const FORMAT = `A template is workbook.json's content plus a guide. workbook.json: { id (lowercase-dashes), name, description, icon?, pages: [{ title, home? (exactly one: the Brief), sections: [{ type: <section type>, title? (defaults to the type's own; a page other than home with one section is that section), collects? (what belongs here, in plain words; defaults to the type's label), instructions? (how to work with it in this kind of work, added to the type's own) }] }] }. Everything else (format, rules, starting content) comes with the section type. Every template needs a goal section; the wizard asks for the goal, and for context when the Brief has a notes section. The guide is markdown for agents: only behaviour specific to this kind of work, since each section's collects and its type's instructions are given to every chat.`;

/**
 * Agent tools for workbook templates: list and read every template on offer
 * (built-in, other plugins', the person's), and save or delete the person's
 * own (kept in kilo.workbooks' data folder, see UserTemplates). Saving
 * validates against the template schema and reports every problem, so an
 * agent can draft a template, fix what's wrong and save again; the New
 * workbook wizard offers it straight away.
 */
export function implementTemplateTools(sdk: PluginSdk, deps: TemplateToolDeps): void {
	const implement = <Input extends z.ZodType>(
		id: (typeof TEMPLATE_TOOL_IDS)[number],
		description: string,
		input: Input,
		run: (input: z.output<Input>) => Promise<unknown>,
	) => {
		sdk.extensions.implement(
			Tool,
			id,
			defineTool({ description, input, run: (parsed) => run(parsed as z.output<Input>) }),
		);
	};

	const own = () => new Set(deps.user.list().map((entry) => entry.folder));

	implement(
		"read_templates",
		`List the workbook templates on offer, or read one in full (id) to copy or change it. Without an id it also describes the section types templates are built from, and the template format. ${FORMAT}`,
		z.object({
			id: z.string().optional().describe("A template id, to read that template in full."),
		}),
		async ({ id }) => {
			if (id) {
				const template = deps.find(id);
				if (!template) throw new KernelError("NOT_FOUND", `No workbook template "${id}".`);
				const { guide, ...rest } = template;
				return { template: rest, guide, yours: own().has(id) };
			}
			const yours = own();
			return {
				templates: deps.all().map((template) => ({
					id: template.id,
					name: template.name,
					description: template.description,
					yours: yours.has(template.id),
				})),
				problems: deps.user
					.list()
					.flatMap((entry) =>
						"problem" in entry ? [{ id: entry.folder, problem: entry.problem }] : [],
					),
				sectionTypes: SECTION_TYPES.map((type) => ({
					type,
					onePerWorkbook: SECTION_CATALOGUE[type].single,
					title: SECTION_CATALOGUE[type].title,
					collects: SECTION_CATALOGUE[type].collects,
					usage: SECTION_CATALOGUE[type].usage,
				})),
				format: FORMAT,
			};
		},
	);

	implement(
		"save_template",
		`Save a workbook template of the user's, new or changed (same id replaces it), so the New workbook wizard offers it. It's checked first; fix what the error names and save again. Built-in ids can't be used. ${FORMAT}`,
		z.object({
			template: z.record(z.string(), z.unknown()).describe("workbook.json's content."),
			guide: z.string().min(1).describe("The guide's markdown (How to work here)."),
		}),
		async ({ template, guide }) => {
			const saved = await deps.user.save(template, guide, deps.contributedIds());
			deps.reread();
			return { saved: saved.id, name: saved.name };
		},
	);

	implement(
		"delete_template",
		"Delete one of the user's workbook templates. Workbooks already made from it keep working.",
		z.object({ id: z.string().min(1) }),
		async ({ id }) => {
			await deps.user.remove(id);
			deps.reread();
			return { deleted: id };
		},
	);
}
