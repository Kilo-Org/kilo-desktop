import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { definePlugin } from "@kilo-desktop/kernel";

import { SessionWorkbooks, WorkbookTemplatePoint, Workbooks } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { NewWorkSessionSection } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	bootWorkbooks,
	pageStart,
	type GuestPlugin,
	type PageStarts,
	type StartedChat,
} from "../test/hosts";

const hosts: PluginHost[] = [];
const slots: { unmount(): void }[] = [];

afterEach(async () => {
	slots.splice(0).forEach((slot) => slot.unmount());
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

/** A plugin contributing simple templates, enough to need the filter. */
function manyTemplates(names: readonly string[]) {
	const id = (name: string) => name.toLowerCase();
	return {
		manifest: {
			manifestVersion: 1,
			id: "example.templates",
			displayName: "Templates",
			version: "1.0.0",
			requires: { "kilo.workbooks/template": "optional" },
			contributes: {
				extensions: { "kilo.workbooks/template": names.map((name) => ({ id: id(name) })) },
			},
		},
		main: definePlugin({
			activate(sdk) {
				for (const name of names) {
					sdk.extensions.implement(WorkbookTemplatePoint, id(name), {
						read: () => ({
							id: id(name),
							name,
							description: `For ${name.toLowerCase()} work.`,
							brief: {
								markdown: "{{goal}}",
								fields: [{ id: "goal", label: "Goal", required: true }],
							},
							guide: { title: "How to work here", markdown: "Be good." },
							firstMove: "Go.",
							sections: [{ id: "notes", title: "Notes", itemType: "note", markdown: "Notes." }],
						}),
					});
				}
			},
		}),
	};
}

async function renderSection(
	options: {
		pages?: FakePages;
		workspaceId?: string | null;
		others?: readonly GuestPlugin[];
	} = {},
) {
	const started: StartedChat[] = [];
	const log: PageStarts = { opened: [], discarded: [] };
	const booted = await bootWorkbooks({
		started,
		...(options.pages ? { pages: options.pages } : {}),
		...(options.others ? { others: options.others } : {}),
	});
	hosts.push(booted.host);
	slots.push(
		booted.host.renderSlot(NewWorkSessionSection, {
			workspaceId: options.workspaceId === undefined ? "ws-1" : options.workspaceId,
			directory: "/repo",
			disabled: false,
			start: pageStart(log),
		}),
	);
	if (options.workspaceId !== null) {
		await expect.element(page.getByTestId("workbooks-section")).toBeVisible();
	}
	return { ...booted, started, log };
}

/** Opens New workbook and picks a template, landing on its Brief. */
async function newWorkbook(templateId = "coding") {
	await userEvent.click(page.getByTestId("workbooks-new"));
	await userEvent.click(page.getByTestId(`workbooks-template-${templateId}`));
	await expect.element(page.getByTestId("workbooks-new-form")).toBeVisible();
}

const moreDetails = () => page.getByTestId("workbooks-more-details").element().textContent;

describe("Start from a workbook on the New Session page", () => {
	it("creates a workbook from the Coding template and starts a session on it", async () => {
		const { host, started, log, pages } = await renderSection();

		await newWorkbook();
		await expect.element(page.getByTestId("workbooks-create")).toBeDisabled();
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Fix the server bug");
		await userEvent.fill(
			page.getByTestId("workbooks-field-goal").element(),
			"Fix the bug in the server",
		);
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(() => log.opened).toEqual(["wses_1"]);
		await expect.element(page.getByTestId("workbooks-new-dialog")).not.toBeInTheDocument();
		const workbooks = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(workbooks.map((workbook) => workbook.name)).toEqual(["Fix the server bug"]);
		expect(pages.projects.size).toBe(1);
		expect(started[0]!.text).toContain('"Fix the server bug"');
		const sessions = host.renderer.kernelSdk.domainObjects.get(SessionWorkbooks)!;
		await expect.poll(() => sessions.getState().bySession).toEqual({ wses_1: workbooks[0]!.id });
	});

	it("continues a workbook already in the workspace", async () => {
		const { host, started, log } = await renderSection();
		await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Existing",
			values: { goal: "g" },
		});

		await userEvent.click(page.getByTestId("workbooks-continue"));

		await expect
			.element(page.getByTestId("workbooks-resume-progress"))
			.toHaveTextContent("0 of 1 plan steps done");
		await userEvent.click(page.getByTestId("workbooks-resume-next"));

		await expect.poll(() => log.opened).toEqual(["wses_1"]);
		expect(started[0]!.text).toContain('"Existing"');
		expect(started[0]!.text).toContain("Plan step 1: Refine the Brief and draft this Plan");
	});

	it("shows where a workbook left off and its open items, and can go back", async () => {
		const { host, pages, started } = await renderSection();
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Busy",
			values: { goal: "g" },
		});
		const section = (id: string) =>
			workbook.sections.find((candidate) => candidate.id === id)!.pageId;
		await pages.call("edit_page", {
			page_id: section("questions"),
			conflict_scope: "target",
			operations: [{ op: "insert_markdown", markdown: "- **Support Windows?** CI cost" }],
		});
		await pages.call("edit_page", {
			page_id: section("tasks"),
			conflict_scope: "target",
			operations: [{ op: "insert_markdown", markdown: "- [ ] One\n- [ ] Two" }],
		});

		await userEvent.click(page.getByTestId("workbooks-continue"));

		await expect
			.element(page.getByTestId("workbooks-resume-open"))
			.toHaveTextContent("1 open question · 2 open tasks");
		await userEvent.click(page.getByTestId("workbooks-resume-questions"));
		await expect.poll(() => started.length).toBe(1);
		expect(started[0]!.text).toContain("open questions");
	});

	it("can go back from a workbook, and start it without a focus when Pages can't be read", async () => {
		const pages = new FakePages();
		const { host, started } = await renderSection({ pages });
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Offline",
			values: { goal: "g" },
		});
		await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Another",
			values: { goal: "g" },
		});
		pages.failOn = "read_page";

		await userEvent.click(page.getByTestId("workbooks-continue"));
		await expect.element(page.getByTestId("workbooks-list")).toBeVisible();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));
		await userEvent.click(page.getByTestId("workbooks-resume-back"));
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));

		await expect
			.element(page.getByTestId("workbooks-resume-loading"))
			.toHaveTextContent("Couldn't read where this workbook is at.");
		await userEvent.click(page.getByTestId("workbooks-resume-start"));
		await expect.poll(() => started.length).toBe(1);
		expect(started[0]!.text).not.toContain("## Work on this");
	});

	it("asks for a template first, then that template's Brief, with Back to the templates", async () => {
		const { host, started } = await renderSection();

		await userEvent.click(page.getByTestId("workbooks-new"));
		await expect.element(page.getByTestId("workbooks-template-coding")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-template-blank")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-template-filter")).not.toBeInTheDocument();
		await userEvent.click(page.getByTestId("workbooks-template-coding"));
		await expect
			.poll(() => moreDetails())
			.toMatch(/Context and links, Acceptance criteria, Constraints and non-goals\W+optional$/);
		await expect.element(page.getByTestId("workbooks-field-acceptance")).not.toBeInTheDocument();
		await userEvent.click(page.getByTestId("workbooks-back"));
		await userEvent.click(page.getByTestId("workbooks-template-blank"));
		await expect.element(page.getByTestId("workbooks-more-details")).not.toBeInTheDocument();
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Scratch");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Poke at things");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(() => started.length).toBe(1);
		const [workbook] = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(workbook).toMatchObject({ templateId: "blank", name: "Scratch" });
		expect(workbook!.sections.map((section) => section.id)).toEqual(["notes"]);
		expect(started[0]!.text).toContain("adding anything worth keeping to Notes");
	});

	it("filters the templates once there are many", async () => {
		await renderSection({
			others: [manyTemplates(["Recipe", "Research", "Release", "Incident", "Analysis"])],
		});

		await userEvent.click(page.getByTestId("workbooks-new"));
		await userEvent.fill(page.getByTestId("workbooks-template-filter").element(), "re");
		await expect.element(page.getByTestId("workbooks-template-recipe")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-template-release")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-template-analysis")).not.toBeInTheDocument();
		await userEvent.fill(page.getByTestId("workbooks-template-filter").element(), "zzz");
		await expect.element(page.getByText('No templates match "zzz".')).toBeVisible();
	});

	it("folds the optional Brief fields into More details, keeping what's filled in", async () => {
		const { host, pages } = await renderSection();

		await newWorkbook();
		await userEvent.click(page.getByTestId("workbooks-more-details"));
		await userEvent.fill(page.getByTestId("workbooks-field-acceptance").element(), "It ticks");
		await expect.poll(() => moreDetails()).toMatch(/1 filled in$/);
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Clock");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Show the time");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect
			.poll(() => host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks.length)
			.toBe(1);
		const [workbook] = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(pages.markdown(pages.documentOf(workbook!.projectId))).toContain(
			"## Acceptance criteria\n\nIt ticks",
		);
	});

	it("shows why a workbook couldn't be created, starting no session", async () => {
		const pages = new FakePages();
		pages.failOn = "create_project";
		const { log } = await renderSection({ pages });
		await newWorkbook();

		await userEvent.fill(page.getByTestId("workbooks-name").element(), "X");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "g");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.element(page.getByTestId("workbooks-start-error")).toBeVisible();
		expect(log.opened).toEqual([]);
		await expect.element(page.getByTestId("workbooks-new-dialog")).toBeVisible();
	});

	it("disables Existing workbook while the workspace has none, and closes New workbook on Cancel", async () => {
		await renderSection();

		await expect.element(page.getByTestId("workbooks-new")).toBeEnabled();
		await expect.element(page.getByTestId("workbooks-continue")).toBeDisabled();
		await userEvent.click(page.getByTestId("workbooks-new"));
		await userEvent.click(page.getByRole("button", { name: "Cancel" }));
		await expect.element(page.getByTestId("workbooks-new-dialog")).not.toBeInTheDocument();
	});
});

describe("without a workspace", () => {
	it("shows nothing: workbooks belong to a workspace", async () => {
		await renderSection({ workspaceId: null });

		await expect.element(page.getByTestId("workbooks-section")).not.toBeInTheDocument();
	});
});
