import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import {
	ITEM_TYPES,
	WORKBOOKS_DEFINITIONS,
	WorkbookTemplatePoint,
	WorkbookTemplates,
	type WorkbookTemplateInput,
} from "../contracts";
import { templateFromFiles } from "./template-files";
import { workbooksMainEntry } from "./index";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const workbooks = { manifest, definitions: WORKBOOKS_DEFINITIONS, main: workbooksMainEntry };

/** A plugin contributing workbook templates, as a third party would. */
function templatePlugin(templates: Record<string, () => unknown>) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "example.templates",
			displayName: "Templates",
			version: "1.0.0",
			requires: { "kilo.workbooks/template": "optional" },
			contributes: {
				extensions: {
					"kilo.workbooks/template": Object.keys(templates).map((id) => ({ id })),
				},
			},
		},
		main: definePlugin({
			activate(sdk) {
				for (const [id, read] of Object.entries(templates)) {
					sdk.extensions.implement(WorkbookTemplatePoint, id, { read });
				}
			},
		}),
	};
}

const recipe: WorkbookTemplateInput = {
	id: "recipe",
	name: "Recipe",
	description: "Cook something new.",
	brief: {
		markdown: "## Dish\n\n{{dish}}",
		fields: [{ id: "dish", label: "Dish", required: true }],
	},
	guide: { title: "How to work here", markdown: "Taste as you go." },
	firstMove: "Ask about servings.",
	sections: [{ id: "method", title: "Method", itemType: "plan-step", markdown: "Steps." }],
};

async function boot(...others: ReturnType<typeof templatePlugin>[]) {
	const host = await createPluginHost([workbooks, ...others]);
	hosts.push(host);
	return { host, templates: host.renderer.kernelSdk.domainObjects.get(WorkbookTemplates)! };
}

describe("workbook templates", () => {
	it("offers the built-in Coding template: the Brief, the guide, Plan and Decisions & findings", async () => {
		const { host, templates } = await boot();

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toEqual(["coding", "blank"]);
		const coding = await host.invoke(WorkbookTemplates, "get", { id: "coding" });

		expect(coding.name).toBe("Coding");
		expect(coding.brief.fields.map((field) => [field.id, field.required])).toEqual([
			["goal", true],
			["context", false],
		]);
		expect(coding.brief.markdown).toContain("{{goal}}");
		expect(coding.guide.title).toBe("How to work here");
		expect(coding.guide.markdown).toContain("Extract, don't archive");
		expect(coding.pages.map((page) => page.title)).toEqual(["Plan", "Decisions & findings"]);
		expect(coding.sections.map((section) => [section.id, section.in])).toEqual([
			["plan", "plan"],
			["follow-ups", "plan"],
			["decisions", "record"],
			["findings", "record"],
			["questions", "brief"],
		]);
		for (const section of coding.sections) expect(ITEM_TYPES).toContain(section.itemType);
		expect(templates.getState().issues).toEqual([]);
	});

	it("offers a Blank template: the Brief and a Notes page", async () => {
		const { host } = await boot();

		const blank = await host.invoke(WorkbookTemplates, "get", { id: "blank" });

		expect(blank.name).toBe("Blank");
		expect(blank.sections.map((section) => [section.id, section.itemType])).toEqual([
			["notes", "note"],
		]);
		expect(blank.brief.fields).toEqual([
			expect.objectContaining({ id: "goal", label: "What's this about?", required: true }),
		]);
		expect(blank.guide.markdown).toContain("add it to **Notes** straight away");
	});

	it("accepts sections that share a page or live in the Brief, under their headings", async () => {
		const { templates } = await boot(
			templatePlugin({
				shared: () => ({
					...recipe,
					id: "shared",
					brief: { ...recipe.brief, markdown: "## Dish\n\n{{dish}}\n\n## Doubts" },
					pages: [{ id: "kitchen", title: "Kitchen", markdown: "## Method\n\n## Tips" }],
					sections: [
						{ id: "method", title: "Method", itemType: "plan-step", in: "kitchen" },
						{ id: "tips", title: "Tips", itemType: "note", in: "kitchen" },
						{ id: "doubts", title: "Doubts", itemType: "question", in: "brief" },
					],
				}),
			}),
		);

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toContain("shared");
		expect(templates.getState().issues).toEqual([]);
	});

	it("offers templates other plugins contribute", async () => {
		const { host, templates } = await boot(templatePlugin({ recipe: () => recipe }));

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toEqual(["coding", "blank", "recipe"]);
		expect(templates.getState().templates[2]).toMatchObject({
			name: "Recipe",
			source: "example.templates/recipe",
			fields: [{ id: "dish", label: "Dish", required: true }],
		});
		await expect(host.invoke(WorkbookTemplates, "get", { id: "recipe" })).resolves.toMatchObject({
			firstMove: "Ask about servings.",
		});
	});

	it("skips invalid templates and repeated ids, reporting why, without hiding the rest", async () => {
		const { templates } = await boot(
			templatePlugin({
				broken: () => ({ ...recipe, id: "broken", sections: [] }),
				clash: () => ({ ...recipe, id: "coding" }),
				throws: () => {
					throw new Error("can't read it");
				},
				optional: () => ({
					...recipe,
					id: "optional",
					brief: { markdown: "", fields: [{ id: "dish", label: "Dish" }] },
				}),
				twice: () => ({
					...recipe,
					id: "twice",
					sections: [recipe.sections[0], recipe.sections[0]],
				}),
				nowhere: () => ({
					...recipe,
					id: "nowhere",
					sections: [{ id: "tips", title: "Tips", itemType: "note", in: "kitchen" }],
				}),
				unheaded: () => ({
					...recipe,
					id: "unheaded",
					sections: [{ id: "tips", title: "Tips", itemType: "note", in: "brief" }],
				}),
			}),
		);

		await expect
			.poll(() => templates.getState().issues.map((issue) => issue.source))
			.toEqual([
				"example.templates/broken",
				"example.templates/clash",
				"example.templates/throws",
				"example.templates/optional",
				"example.templates/twice",
				"example.templates/nowhere",
				"example.templates/unheaded",
			]);
		const messages = templates.getState().issues.map((issue) => issue.message);
		expect(messages[0]).toContain("sections");
		expect(messages[1]).toContain('"coding" is already taken');
		expect(messages[2]).toBe("can't read it");
		expect(messages[3]).toContain("at least one required field");
		expect(messages[4]).toContain('section "method" appears more than once');
		expect(messages[5]).toContain(`is in page "kitchen", which the template doesn't have`);
		expect(messages[6]).toContain('needs a "Tips" heading in "brief"');
		expect(templates.getState().templates.map((template) => template.id)).toEqual([
			"coding",
			"blank",
		]);
	});

	it("refuses an unknown template id", async () => {
		const { host } = await boot();

		await expect(host.invoke(WorkbookTemplates, "get", { id: "nope" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("templateFromFiles", () => {
	const manifestJson = {
		schemaVersion: 1,
		id: "t",
		name: "T",
		description: "D",
		brief: { file: "brief.md", fields: [{ id: "goal", label: "Goal", required: true }] },
		guide: { file: "AGENTS.md", title: "Guide" },
		firstMove: "Go.",
		sections: [{ id: "plan", title: "Plan", itemType: "plan-step", file: "plan.md" }],
	};

	it("names every missing file", () => {
		expect(() => templateFromFiles(manifestJson, { "brief.md": "" })).toThrow(
			"missing template files: AGENTS.md, plan.md",
		);
	});

	it("rejects a manifest of another schema version", () => {
		expect(() => templateFromFiles({ ...manifestJson, schemaVersion: 2 }, {})).toThrow();
	});
});
