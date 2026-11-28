import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { definePlugin } from "@kilo-desktop/kernel";
import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";

import {
	findItem,
	oneLine,
	SectionTypePoint,
	SectionTypes,
	SessionWorkbooks,
	WorkbookTemplatePoint,
	WorkbookTemplates,
	Workbooks,
	type SectionTypeDefinition,
} from "../contracts";
import { bootWorkbooks } from "../test/hosts";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const DATED = /^- \*\*(\d{4}-\d{2}-\d{2})\*\* /;

/** A third party's section type, written only against kilo.workbooks' contracts. */
const calendar: SectionTypeDefinition = {
	single: false,
	title: "Calendar",
	collects: "Dated events and deadlines.",
	usage:
		"Add events as they're set (add_item: text = the event, detail = its date); reschedule with reschedule.",
	starter: () => "- Nothing scheduled.",
	async add(context, section, item) {
		const date = item.detail?.trim() ?? "";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Give the date as detail (YYYY-MM-DD).");
		const line = `- **${date}** ${oneLine(item.text)}`;
		await context.edit(section, (lines, edits) => {
			const placeholder = lines.find((candidate) => candidate.text === "- Nothing scheduled.");
			const later = lines.find((candidate) => (DATED.exec(candidate.text)?.[1] ?? "") > date);
			if (later) edits.insertBefore(later, [line]);
			else edits.append(line);
			if (placeholder) edits.remove(placeholder);
		});
		return { written: line };
	},
	actions: {
		reschedule: {
			description: "Move an event (event = words from it) to another date (date, YYYY-MM-DD).",
			input: z.object({ event: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
			run: (context, section, input: { event: string; date: string }) =>
				context.edit(section, (lines, edits) => {
					const line = findItem(lines, input.event, section);
					const text = line.text.replace(DATED, `- **${input.date}** `);
					edits.set(line, text);
					return text;
				}),
		},
	},
	refusals: { remove: "Reschedule an event instead." },
};

const party = {
	id: "party",
	name: "Party",
	description: "Plan a party.",
	guide: "Have fun.",
	pages: [
		{ title: "Brief", home: true, sections: [{ type: "goal" }] },
		{ title: "Dates", sections: [{ type: "calendar" }] },
	],
};

function calendarPlugin(types: Record<string, unknown> = { calendar }) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "example.calendar",
			displayName: "Calendar",
			version: "1.0.0",
			requires: {
				"kilo.workbooks/section-type": "optional",
				"kilo.workbooks/template": "optional",
			},
			contributes: {
				extensions: {
					"kilo.workbooks/section-type": Object.keys(types).map((id) => ({ id })),
					"kilo.workbooks/template": [{ id: "party" }],
				},
			},
		},
		main: definePlugin({
			activate(sdk) {
				for (const [id, type] of Object.entries(types)) {
					sdk.extensions.implement(SectionTypePoint, id, type as SectionTypeDefinition);
				}
				sdk.extensions.implement(WorkbookTemplatePoint, "party", { read: () => party });
			},
		}),
	};
}

async function boot(others: ReturnType<typeof calendarPlugin>[] = []) {
	const booted = await bootWorkbooks({ others });
	hosts.push(booted.host);
	const { host } = booted;
	const call = async (id: string, input: unknown) => {
		const tools = () => host.main.kernelSdk.extensions.list(Tool);
		await expect.poll(() => tools().some((tool) => tool.key === `kilo.workbooks/${id}`)).toBe(true);
		const tool = tools().find((candidate) => candidate.key === `kilo.workbooks/${id}`)!;
		const context: ToolCallContext = {
			workSessionId: "wses_1",
			workspaceId: "ws-1",
			chatId: "chat",
			callId: "call",
			external: false,
			signal: new AbortController().signal,
		};
		return tool.implementation!.run(tool.implementation!.input.parse(input), context) as Promise<
			Record<string, unknown>
		>;
	};
	const state = () => host.main.kernelSdk.domainObjects.get(SectionTypes)!.getState();
	const templates = () => host.main.kernelSdk.domainObjects.get(WorkbookTemplates)!.getState();
	return { ...booted, call, state, templates };
}

describe("section types", () => {
	it("are offered from the extension point, kilo.workbooks' own built-ins included", async () => {
		const { state } = await boot();

		expect(state().types.map((type) => [type.id, type.source])).toEqual([
			["goal", "kilo.workbooks/goal"],
			["plan", "kilo.workbooks/plan"],
			["handoff", "kilo.workbooks/handoff"],
			["activity", "kilo.workbooks/activity"],
			["change-log", "kilo.workbooks/change-log"],
			["todo", "kilo.workbooks/todo"],
			["log", "kilo.workbooks/log"],
			["questions", "kilo.workbooks/questions"],
			["notes", "kilo.workbooks/notes"],
			["output", "kilo.workbooks/output"],
		]);
		expect(
			state()
				.types.find((type) => type.id === "plan")!
				.actions.map((action) => action.name),
		).toEqual(["add_task", "set_task_done", "edit_step", "move_step"]);
		expect(state().issues).toEqual([]);
	});

	it("can come from another plugin, with a template that uses it, its own format and its own action", async () => {
		const { call, host, pages, state, templates } = await boot([calendarPlugin()]);

		await expect.poll(() => state().types.map((type) => type.id)).toContain("calendar");
		await expect
			.poll(() => templates().templates.map((template) => template.id))
			.toContain("party");
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "party",
			name: "Birthday",
			values: { goal: "A birthday party" },
		});
		await host.invoke(SessionWorkbooks, "setActive", {
			workSessionId: "wses_1",
			workbookId: workbook.id,
		});
		const dates = workbook.sections.find((section) => section.type === "calendar")!;
		expect(pages.markdown(dates.pageId!)).toBe(
			"_Dated events and deadlines._\n\n- Nothing scheduled.",
		);

		await call("add_item", { section: dates.id, text: "Party", detail: "2026-12-12" });
		await call("add_item", { section: dates.id, text: "Send invites", detail: "2026-12-01" });
		expect(pages.markdown(dates.pageId!)).toBe(
			"_Dated events and deadlines._\n\n- **2026-12-01** Send invites\n- **2026-12-12** Party",
		);

		const read = await call("read_workbook", { section: dates.id });
		expect(
			(read.sections as { id: string; actions?: unknown }[]).find((entry) => entry.id === dates.id),
		).toMatchObject({
			usage: expect.stringContaining("reschedule"),
			actions: [{ name: "reschedule", description: expect.stringContaining("Move an event") }],
		});
		await expect(
			call("section_action", {
				section: dates.id,
				action: "reschedule",
				input: { event: "party", date: "2026-12-13" },
			}),
		).resolves.toMatchObject({ result: "- **2026-12-13** Party" });
		await expect(
			call("section_action", {
				section: dates.id,
				action: "reschedule",
				input: { event: "party", date: "soon" },
			}),
		).rejects.toThrow('"reschedule" input: date');
		await expect(call("section_action", { section: dates.id, action: "cancel" })).rejects.toThrow(
			'has no "cancel" action (it has: reschedule)',
		);
		await expect(call("remove_item", { section: dates.id, item: "party" })).rejects.toThrow(
			"Reschedule an event instead.",
		);
	});

	it("leave out a template whose section type nobody offers", async () => {
		const { templates } = await boot([calendarPlugin({})]);

		await expect
			.poll(() => templates().issues.map((issue) => issue.source))
			.toContain("example.calendar/party");
		expect(
			templates().issues.find((issue) => issue.source === "example.calendar/party")!.message,
		).toContain('needs section type "calendar", which isn\'t installed');
	});

	it("report a malformed type, or one whose id is already taken, without hiding the rest", async () => {
		const { state, templates } = await boot([
			calendarPlugin({ calendar, plan: { ...calendar }, broken: { single: "no" } }),
		]);

		await expect
			.poll(() => state().issues.map((issue) => issue.source))
			.toEqual(["example.calendar/plan", "example.calendar/broken"]);
		expect(state().issues[0]!.message).toContain('the id "plan" is already taken');
		expect(state().issues[1]!.message).toContain("single");
		expect(state().types.find((type) => type.id === "plan")!.source).toBe("kilo.workbooks/plan");
		await expect
			.poll(() => templates().templates.map((template) => template.id))
			.toContain("party");
	});

	it("keep a workbook working when one of its section types goes away, refusing only that section", async () => {
		const { call, host, pages } = await boot();
		const projectId = pages.addProject("Old", "", ["Dates"]);
		const [dates] = pages.pagesOf(projectId).map((entry) => entry.id);
		const workbook = await host.invoke(Workbooks, "add", {
			workspaceId: null,
			name: "Old",
			templateId: "party",
			backend: { kind: "pages-mcp", server: "pages" },
			projectId,
			sections: [
				{ id: "dates", type: "calendar", pageId: dates! },
				{ id: "notes", type: "notes", title: "Notes", heading: "Notes", pageId: dates! },
			],
		});
		const own = { workbookId: workbook.id };

		const read = await call("read_workbook", { section: "dates", ...own });
		expect((read.sections as { id: string; usage: string }[])[0]!.usage).toContain(
			"isn't installed",
		);
		await expect(call("add_item", { section: "dates", text: "x", ...own })).rejects.toThrow(
			'"calendar" section, and that section type isn\'t installed',
		);
		await call("write_section", { section: "notes", markdown: "Still works", ...own });
		expect(pages.markdown(dates!)).toContain("Still works");
	});
});
