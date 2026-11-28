import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import {
	SECTION_CATALOGUE,
	WORKBOOKS_DEFINITIONS,
	WorkbookTemplatePoint,
	WorkbookTemplates,
	resolveSections,
	type WorkbookTemplate,
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
	guide: "Taste as you go.",
	pages: [
		{ title: "Brief", home: true, sections: [{ type: "goal", title: "What are we cooking?" }] },
		{
			title: "Kitchen",
			sections: [
				{ type: "plan", title: "Method" },
				{ type: "log", title: "Tweaks", collects: "Changes tried, and how they turned out." },
			],
		},
		{ title: "Shopping list", sections: [{ type: "todo", collects: "What to buy." }] },
		{ title: "The recipe", sections: [{ type: "output" }] },
	],
};

/** The recipe with its Kitchen page holding `sections`. */
const withKitchen = (id: string, sections: unknown[]) => ({
	...recipe,
	id,
	pages: [recipe.pages[0], { title: "Kitchen", sections }],
});

async function boot(...others: ReturnType<typeof templatePlugin>[]) {
	const host = await createPluginHost([workbooks, ...others]);
	hosts.push(host);
	return { host, templates: host.renderer.kernelSdk.domainObjects.get(WorkbookTemplates)! };
}

const summarise = (template: WorkbookTemplate) =>
	resolveSections(template).flatMap(({ page, sections }) =>
		sections.map((section) => [page.title, section.id, section.type, section.heading ?? null]),
	);

describe("workbook templates", () => {
	it("offers the built-in Coding template, built only from section types and words", async () => {
		const { host, templates } = await boot();

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toEqual(["coding", "blank"]);
		const coding = await host.invoke(WorkbookTemplates, "get", { id: "coding" });

		expect(coding.name).toBe("Coding");
		expect(coding.guide).toContain("Extract, don't archive");
		expect(templates.getState().templates[0]).toMatchObject({
			fields: [
				{ id: "goal", label: "Goal", required: true },
				{ id: "context-and-links", label: "Context and links", required: false },
			],
			firstMove: expect.stringContaining("draft the Plan"),
		});
		expect(summarise(coding)).toEqual([
			["Brief", "goal", "goal", "Goal"],
			["Brief", "handoff", "handoff", "Where we left off"],
			["Brief", "activity", "activity", "Who's working on what"],
			["Brief", "questions", "questions", "Open questions"],
			["Brief", "context-and-links", "notes", "Context and links"],
			["Brief", "constraints-and-non-goals", "todo", "Constraints and non-goals"],
			["Brief", "acceptance-criteria", "todo", "Acceptance criteria"],
			["Plan", "plan", "plan", null],
			["Follow-ups", "follow-ups", "todo", null],
			["Decisions & findings", "decisions", "log", "Decisions"],
			["Decisions & findings", "findings", "log", "Findings"],
			["Change Log", "change-log", "change-log", null],
		]);
		const plan = resolveSections(coding)[1]!.sections[0]!;
		expect(plan).toMatchObject({
			collects: SECTION_CATALOGUE.plan.collects,
			instructions: expect.stringContaining("Each step ends in one commit"),
		});
		expect(templates.getState().issues).toEqual([]);
	});

	it("offers a Blank template: the Brief and a Notes page", async () => {
		const { host, templates } = await boot();

		const blank = await host.invoke(WorkbookTemplates, "get", { id: "blank" });

		expect(summarise(blank)).toEqual([
			["Brief", "goal", "goal", "What this is about"],
			["Brief", "handoff", "handoff", "Where we left off"],
			["Notes", "notes", "log", null],
		]);
		await expect
			.poll(() => templates.getState().templates[1]?.fields)
			.toEqual([
				{
					id: "goal",
					label: "What this is about",
					required: true,
					hint: SECTION_CATALOGUE.goal.collects,
				},
			]);
	});

	it("offers templates other plugins contribute, built from the same section types", async () => {
		const { host, templates } = await boot(templatePlugin({ recipe: () => recipe }));

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toEqual(["coding", "blank", "recipe"]);
		expect(templates.getState().templates[2]).toMatchObject({
			name: "Recipe",
			source: "example.templates/recipe",
			fields: [{ id: "goal", label: "What are we cooking?", required: true }],
		});
		const template = await host.invoke(WorkbookTemplates, "get", { id: "recipe" });
		expect(summarise(template).map(([, id, type, heading]) => [id, type, heading])).toEqual([
			["goal", "goal", "What are we cooking?"],
			["plan", "plan", "Method"],
			["tweaks", "log", "Tweaks"],
			["shopping-list", "todo", null],
			["the-recipe", "output", null],
		]);
		expect(templates.getState().issues).toEqual([]);
	});

	it("skips invalid templates and repeated ids, reporting why, without hiding the rest", async () => {
		const { templates } = await boot(
			templatePlugin({
				broken: () => ({ ...recipe, id: "broken", pages: [] }),
				clash: () => ({ ...recipe, id: "coding" }),
				throws: () => {
					throw new Error("can't read it");
				},
				unknown: () => withKitchen("unknown", [{ type: "journal" }]),
				twice: () =>
					withKitchen("twice", [
						{ type: "log", title: "Tips" },
						{ type: "log", title: "tips" },
					]),
				plans: () =>
					withKitchen("plans", [
						{ type: "plan", title: "Method" },
						{ type: "plan", title: "More" },
					]),
				tweaked: () => withKitchen("tweaked", [{ type: "log", title: "Tips", fields: ["why"] }]),
				goalless: () => ({
					...recipe,
					id: "goalless",
					pages: [{ title: "Brief", home: true, sections: [{ type: "notes" }] }],
				}),
				homeless: () => ({ ...recipe, id: "homeless", pages: recipe.pages.slice(1) }),
			}),
		);

		await expect
			.poll(() => templates.getState().issues.map((issue) => issue.source))
			.toEqual([
				"example.templates/broken",
				"example.templates/clash",
				"example.templates/throws",
				"example.templates/unknown",
				"example.templates/twice",
				"example.templates/plans",
				"example.templates/tweaked",
				"example.templates/goalless",
				"example.templates/homeless",
			]);
		const messages = templates.getState().issues.map((issue) => issue.message);
		expect(messages[0]).toContain("pages");
		expect(messages[1]).toContain('"coding" is already taken');
		expect(messages[2]).toBe("can't read it");
		expect(messages[3]).toContain("Invalid option");
		expect(messages[4]).toContain('two sections would both be "tips"');
		expect(messages[5]).toContain("only one section can be a plan");
		expect(messages[6]).toContain('Unrecognized key: "fields"');
		expect(messages[7]).toContain("a template needs a goal section");
		expect(messages[8]).toContain("exactly one page must be the home page");
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
		schemaVersion: 3,
		id: "t",
		name: "T",
		description: "D",
		pages: [{ title: "Brief", home: true, sections: [{ type: "goal" }] }],
	};

	it("needs the guide", () => {
		expect(() => templateFromFiles(manifestJson, {})).toThrow("missing template file: AGENTS.md");
	});

	it("reads the guide from its file", () => {
		expect(templateFromFiles(manifestJson, { "AGENTS.md": "Guide." })).toMatchObject({
			id: "t",
			guide: "Guide.",
		});
	});

	it("rejects a manifest of another schema version", () => {
		expect(() => templateFromFiles({ ...manifestJson, schemaVersion: 2 }, {})).toThrow();
	});
});
