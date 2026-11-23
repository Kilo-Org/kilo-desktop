import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import {
	SECTION_TYPES,
	WORKBOOKS_DEFINITIONS,
	WorkbookTemplatePoint,
	WorkbookTemplates,
	sectionType,
	templateSections,
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

const home = {
	id: "home",
	title: "Brief",
	home: true,
	sections: [{ id: "dish", title: "Dish", role: "goal" as const }],
};

const recipe: WorkbookTemplateInput = {
	id: "recipe",
	name: "Recipe",
	description: "Cook something new.",
	guide: { title: "How to work here", markdown: "Taste as you go." },
	firstMove: "Ask about servings.",
	intake: [{ fills: "dish", label: "Dish", required: true }],
	pages: [
		home,
		{
			id: "kitchen",
			title: "Kitchen",
			sections: [
				{ id: "method", title: "Method", role: "plan", requires: ["tasks-ticked"] },
				{
					id: "tweaks",
					title: "Tweaks",
					type: "journal",
					collects: "Changes tried, and how they turned out.",
				},
			],
		},
		{
			id: "shopping",
			title: "Shopping list",
			sections: [{ id: "shopping", type: "checklist", collects: "What to buy." }],
		},
	],
};

/** The recipe with a Kitchen page holding `sections`. */
const withKitchen = (id: string, sections: unknown[]) => ({
	...recipe,
	id,
	pages: [home, { id: "kitchen", title: "Kitchen", sections }],
});

async function boot(...others: ReturnType<typeof templatePlugin>[]) {
	const host = await createPluginHost([workbooks, ...others]);
	hosts.push(host);
	return { host, templates: host.renderer.kernelSdk.domainObjects.get(WorkbookTemplates)! };
}

describe("workbook templates", () => {
	it("offers the built-in Coding template: the Brief, the guide, Plan, Follow-ups, Decisions & findings and Change Log", async () => {
		const { host, templates } = await boot();

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toEqual(["coding", "blank"]);
		const coding = await host.invoke(WorkbookTemplates, "get", { id: "coding" });

		expect(coding.name).toBe("Coding");
		expect(
			templates.getState().templates[0]!.fields.map((field) => [field.id, field.required]),
		).toEqual([
			["goal", true],
			["context", false],
		]);
		expect(coding.guide.title).toBe("How to work here");
		expect(coding.guide.markdown).toContain("Extract, don't archive");
		expect(coding.pages.map((page) => page.title)).toEqual([
			"Brief",
			"Plan",
			"Follow-ups",
			"Decisions & findings",
			"Change Log",
		]);
		expect(
			templateSections(coding).map(({ page, section }) => [
				page.id,
				section.id,
				sectionType(section),
				section.role,
			]),
		).toEqual([
			["home", "goal", "text", "goal"],
			["home", "handoff", "journal", "handoff"],
			["home", "questions", "questions", undefined],
			["home", "context", "text", undefined],
			["home", "constraints", "checklist", undefined],
			["home", "criteria", "checklist", undefined],
			["plan", "plan", "steps", "plan"],
			["follow-ups", "follow-ups", "checklist", undefined],
			["record", "decisions", "journal", undefined],
			["record", "findings", "journal", undefined],
			["change-log", "change-log", "journal", undefined],
		]);
		for (const { section } of templateSections(coding)) {
			expect(SECTION_TYPES).toContain(sectionType(section));
			expect(section.collects).toEqual(expect.any(String));
		}
		expect(templates.getState().issues).toEqual([]);
	});

	it("offers a Blank template: the Brief and a Notes page", async () => {
		const { host, templates } = await boot();

		const blank = await host.invoke(WorkbookTemplates, "get", { id: "blank" });

		expect(blank.name).toBe("Blank");
		expect(
			templateSections(blank).map(({ section }) => [section.id, sectionType(section)]),
		).toEqual([
			["goal", "text"],
			["handoff", "journal"],
			["notes", "journal"],
		]);
		await expect
			.poll(() => templates.getState().templates[1]?.fields)
			.toEqual([
				expect.objectContaining({ id: "goal", label: "What's this about?", required: true }),
			]);
		expect(blank.guide.markdown).toContain("add it to **Notes** straight away");
	});

	it("offers templates other plugins contribute, built from the shared vocabulary", async () => {
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
				untyped: () => withKitchen("untyped", [{ id: "tips", title: "Tips" }]),
				twice: () =>
					withKitchen("twice", [
						{ id: "tips", title: "Tips", type: "journal" },
						{ id: "tips", title: "More", type: "journal" },
					]),
				clashing: () =>
					withKitchen("clashing", [
						{ id: "method", title: "Method", type: "journal", role: "plan" },
					]),
				misruled: () =>
					withKitchen("misruled", [
						{ id: "tips", title: "Tips", type: "journal", requires: ["link-or-reason"] },
					]),
				untitled: () =>
					withKitchen("untitled", [
						{ id: "tips", type: "journal" },
						{ id: "more", title: "More", type: "journal" },
					]),
				goalless: () => ({
					...recipe,
					id: "goalless",
					pages: [
						{
							id: "home",
							title: "Brief",
							home: true,
							sections: [{ id: "dish", title: "Dish", type: "text" }],
						},
					],
				}),
				history: () =>
					withKitchen("history", [
						{ id: "where", title: "Where", role: "handoff", history: "method" },
						{ id: "method", title: "Method", role: "plan" },
					]),
			}),
		);

		await expect
			.poll(() => templates.getState().issues.map((issue) => issue.source))
			.toEqual([
				"example.templates/broken",
				"example.templates/clash",
				"example.templates/throws",
				"example.templates/untyped",
				"example.templates/twice",
				"example.templates/clashing",
				"example.templates/misruled",
				"example.templates/untitled",
				"example.templates/goalless",
				"example.templates/history",
			]);
		const messages = templates.getState().issues.map((issue) => issue.message);
		expect(messages[0]).toContain("pages");
		expect(messages[1]).toContain('"coding" is already taken');
		expect(messages[2]).toBe("can't read it");
		expect(messages[3]).toContain('section "tips" needs a type or a role');
		expect(messages[4]).toContain('section "tips" appears more than once');
		expect(messages[5]).toContain("the plan role is a steps section");
		expect(messages[6]).toContain('"requires" is for steps sections');
		expect(messages[7]).toContain('section "tips" needs a title');
		expect(messages[8]).toContain("a section needs the goal role");
		expect(messages[9]).toContain('its history "method" must be a journal section');
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
		schemaVersion: 2,
		id: "t",
		name: "T",
		description: "D",
		guide: { file: "AGENTS.md", title: "Guide" },
		firstMove: "Go.",
		intake: [{ fills: "goal", label: "Goal", required: true }],
		pages: [{ id: "home", title: "Brief", home: true, introFile: "intro.md", sections: [] }],
	};

	it("names every missing file", () => {
		expect(() => templateFromFiles(manifestJson, {})).toThrow(
			"missing template files: AGENTS.md, intro.md",
		);
	});

	it("reads the guide and page intros from their files", () => {
		expect(
			templateFromFiles(manifestJson, { "AGENTS.md": "Guide.", "intro.md": "Hello." }),
		).toMatchObject({
			guide: { title: "Guide", markdown: "Guide." },
			pages: [{ id: "home", intro: "Hello." }],
		});
	});

	it("rejects a manifest of another schema version", () => {
		expect(() => templateFromFiles({ ...manifestJson, schemaVersion: 1 }, {})).toThrow();
	});
});
