import { afterEach, describe, expect, it } from "vitest";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import { WorkbookTemplates, Workbooks } from "../contracts";
import { bootWorkbooks, memoryFs } from "../test/hosts";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const recipe = {
	id: "recipe",
	name: "Recipe",
	description: "Cook something new.",
	pages: [
		{ title: "Brief", home: true, sections: [{ type: "goal", title: "Dish" }] },
		{
			title: "Kitchen",
			sections: [
				{ type: "plan", title: "Method" },
				{ type: "log", title: "Tweaks", collects: "Changes tried." },
			],
		},
	],
};

async function boot(fs = memoryFs()) {
	const booted = await bootWorkbooks({ fs });
	hosts.push(booted.host);
	const { host } = booted;
	const templates = host.main.kernelSdk.domainObjects.get(WorkbookTemplates)!;
	const call = async (id: string, input: unknown) => {
		const tools = () => host.main.kernelSdk.extensions.list(Tool);
		await expect.poll(() => tools().some((tool) => tool.key === `kilo.workbooks/${id}`)).toBe(true);
		const tool = tools().find((candidate) => candidate.key === `kilo.workbooks/${id}`)!;
		const context: ToolCallContext = {
			workSessionId: null,
			workspaceId: null,
			chatId: "chat",
			callId: "call",
			external: false,
			signal: new AbortController().signal,
		};
		return tool.implementation!.run(tool.implementation!.input.parse(input), context) as Promise<
			Record<string, unknown>
		>;
	};
	return { ...booted, templates, call };
}

describe("the user's own workbook templates", () => {
	it("are saved to kilo.workbooks' data folder and offered straight away", async () => {
		const { call, fs, templates, host } = await boot();

		await expect(
			call("save_template", { template: recipe, guide: "Taste as you go." }),
		).resolves.toEqual({
			saved: "recipe",
			name: "Recipe",
		});

		expect(JSON.parse(fs.files.get("templates/recipe/workbook.json")!)).toEqual({
			schemaVersion: 3,
			...recipe,
		});
		expect(fs.files.get("templates/recipe/AGENTS.md")).toBe("Taste as you go.\n");
		expect(
			templates.getState().templates.map((template) => [template.id, template.source]),
		).toContainEqual(["recipe", "your templates/recipe"]);
		const created = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "recipe",
			name: "Curry",
			values: { goal: "A weeknight curry" },
		});
		expect(created.sections.map((section) => section.id)).toEqual(["goal", "plan", "tweaks"]);
	});

	it("are loaded when the plugin starts, reporting a broken one without hiding the rest", async () => {
		const fs = memoryFs();
		fs.files.set("templates/recipe/workbook.json", JSON.stringify({ schemaVersion: 3, ...recipe }));
		fs.files.set("templates/recipe/AGENTS.md", "Guide.");
		fs.files.set("templates/broken/workbook.json", "{ not json");
		const { templates, host } = await boot(fs);

		await expect
			.poll(() => templates.getState().templates.map((template) => template.id))
			.toEqual(["coding", "blank", "recipe"]);
		const shown = host.renderer.kernelSdk.domainObjects.get(WorkbookTemplates)!;
		expect(shown.getState().templates.map((template) => template.id)).toContain("recipe");
		expect(templates.getState().issues).toEqual([
			{ source: "your templates/broken", message: expect.stringContaining("JSON") },
		]);
	});

	it("are checked before they're saved, and can't take a built-in's id", async () => {
		const { call, fs } = await boot();

		await expect(
			call("save_template", { template: { ...recipe, pages: [] }, guide: "G" }),
		).rejects.toThrow("Not a valid workbook template: pages");
		await expect(
			call("save_template", { template: { ...recipe, id: "coding" }, guide: "G" }),
		).rejects.toThrow('"coding" is a built-in template\'s id');
		expect([...fs.files.keys()]).toEqual([]);
	});

	it("are listed and read with the section types and format, and can be deleted", async () => {
		const { call, templates } = await boot();
		await call("save_template", { template: recipe, guide: "Taste as you go." });

		const list = await call("read_templates", {});
		expect(list.templates).toContainEqual({
			id: "recipe",
			name: "Recipe",
			description: "Cook something new.",
			yours: true,
		});
		expect(list.templates).toContainEqual(expect.objectContaining({ id: "coding", yours: false }));
		expect((list.sectionTypes as { id: string }[]).map((entry) => entry.id)).toContain("output");
		await expect(call("read_templates", { id: "recipe" })).resolves.toMatchObject({
			template: { id: "recipe" },
			guide: "Taste as you go.\n",
			yours: true,
		});

		await call("delete_template", { id: "recipe" });
		expect(templates.getState().templates.map((template) => template.id)).toEqual([
			"coding",
			"blank",
		]);
		await expect(call("delete_template", { id: "coding" })).rejects.toThrow(
			'No template of yours is called "coding"',
		);
	});
});
