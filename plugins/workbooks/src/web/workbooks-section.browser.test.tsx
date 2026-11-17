import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { definePlugin } from "@kilo-desktop/kernel";

import { SessionWorkbooks, WorkbookTemplatePoint, Workbooks } from "../contracts";
import { FakePages } from "../test/fake-pages";
import {
	NewWorkSessionSection,
	type NewWorkSessionSectionProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

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
		/** Overrides the page's start(), e.g. to fail. */
		start?: NewWorkSessionSectionProps["start"];
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
			directory: options.workspaceId === null ? null : "/repo",
			disabled: false,
			start: options.start ?? pageStart(log),
		}),
	);
	await expect.element(page.getByTestId("workbooks-section")).toBeVisible();
	return { ...booted, started, log };
}

/** Opens the Workbook picker. */
async function openPicker() {
	await userEvent.click(page.getByTestId("workbooks-picker-trigger"));
	await expect.element(page.getByTestId("workbooks-picker")).toBeVisible();
}

/** Opens the picker's New workbook, landing on the template step. */
async function openNewWorkbook() {
	await openPicker();
	await userEvent.click(page.getByTestId("workbooks-new"));
}

/** Opens New workbook and picks a template, landing on its Brief. */
async function newWorkbook(templateId = "coding") {
	await openNewWorkbook();
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

	it("selects a workbook, then starts a session on it from Start session", async () => {
		const { host, started, log } = await renderSection();
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Existing",
			values: { goal: "g" },
		});
		await expect.element(page.getByTestId("workbooks-start")).not.toBeInTheDocument();

		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));

		await expect.element(page.getByTestId("workbooks-picker")).not.toBeInTheDocument();
		await expect
			.poll(() => page.getByTestId("workbooks-picker-trigger").element().textContent)
			.toContain("Existing");
		expect(log.opened).toEqual([]);
		await openPicker();
		await expect
			.element(page.getByTestId(`workbooks-continue-${workbook.id}`))
			.toHaveAttribute("data-checked", "true");
		await userEvent.keyboard("{Escape}");

		await userEvent.click(page.getByTestId("workbooks-start"));

		await expect.poll(() => log.opened).toEqual(["wses_1"]);
		expect(started[0]!.text).toContain('"Existing"');
		expect(started[0]!.text).not.toContain("## Work on this");
		await expect.element(page.getByTestId("workbooks-picker")).not.toBeInTheDocument();
	});

	it("asks for a template first, then that template's Brief, with Back to the templates", async () => {
		const { host, started } = await renderSection();

		await openNewWorkbook();
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

	it("lists workbooks with their template, and searches them", async () => {
		const { host } = await renderSection();
		const create = (name: string, templateId: string) =>
			host.invoke(Workbooks, "create", {
				workspaceId: "ws-1",
				templateId,
				name,
				values: { goal: "g" },
			});
		const clock = await create("Right side panel clock", "coding");
		const notes = await create("Reading notes", "blank");

		await openPicker();

		await expect
			.poll(() => page.getByTestId(`workbooks-continue-${clock.id}`).element().textContent)
			.toContain("Right side panel clockCoding");
		await expect
			.poll(() => page.getByTestId(`workbooks-continue-${notes.id}`).element().textContent)
			.toContain("Reading notesBlank");
		await userEvent.fill(page.getByPlaceholder("Search workbooks").element(), "clock");
		await expect
			.element(page.getByTestId(`workbooks-continue-${notes.id}`))
			.not.toBeInTheDocument();
		await userEvent.fill(page.getByPlaceholder("Search workbooks").element(), "blank");
		await expect.element(page.getByTestId(`workbooks-continue-${notes.id}`)).toBeVisible();
		await expect
			.element(page.getByTestId(`workbooks-continue-${clock.id}`))
			.not.toBeInTheDocument();
		await userEvent.fill(page.getByPlaceholder("Search workbooks").element(), "zzz");
		await expect.element(page.getByText("No workbooks found.")).toBeVisible();
	});

	it("filters the templates once there are many", async () => {
		await renderSection({
			others: [manyTemplates(["Recipe", "Research", "Release", "Incident", "Analysis"])],
		});

		await openNewWorkbook();
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

	it("offers New workbook in an empty picker, and closes the wizard on Cancel", async () => {
		await renderSection();

		await openPicker();
		await expect.element(page.getByText("No workbooks yet.")).toBeVisible();
		await userEvent.click(page.getByTestId("workbooks-new"));
		await expect.element(page.getByTestId("workbooks-new-dialog")).toBeVisible();
		await userEvent.click(page.getByRole("button", { name: "Cancel" }));
		await expect.element(page.getByTestId("workbooks-new-dialog")).not.toBeInTheDocument();
	});

	it("starts no session when the page can't start one, and can be used again", async () => {
		let attempts = 0;
		const { host, started } = await renderSection({
			start: async () => {
				attempts += 1;
				throw new Error("no worktree");
			},
		});
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Stuck",
			values: { goal: "g" },
		});

		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));
		await userEvent.click(page.getByTestId("workbooks-start"));

		await expect.poll(() => attempts).toBe(1);
		await expect.element(page.getByTestId("workbooks-start")).toBeEnabled();
		expect(started).toEqual([]);
	});

	it("drops the selection when the workbook is forgotten", async () => {
		const { host } = await renderSection();
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Soon gone",
			values: { goal: "g" },
		});
		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));
		await expect.element(page.getByTestId("workbooks-start")).toBeVisible();

		await host.invoke(Workbooks, "forget", { id: workbook.id });

		await expect.element(page.getByTestId("workbooks-start")).not.toBeInTheDocument();
		await expect
			.poll(() => page.getByTestId("workbooks-picker-trigger").element().textContent)
			.toBe("Workbook");
	});

	it("opens the picker from the keyboard", async () => {
		await renderSection();

		page.getByTestId("workbooks-picker-trigger").element().focus();
		await userEvent.keyboard("{ArrowDown}");

		await expect.element(page.getByTestId("workbooks-picker")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("workbooks-picker")).not.toBeInTheDocument();
	});

	it("puts the workspace's workbooks first, then the others under their own heading", async () => {
		const { host } = await renderSection();
		const add = (name: string, workspaceId: string | null) =>
			host.invoke(Workbooks, "create", {
				workspaceId,
				templateId: "blank",
				name,
				values: { goal: "g" },
			});
		const elsewhere = await add("Started without a workspace", null);
		const here = await add("Started here", "ws-1");

		await openPicker();

		await expect.element(page.getByText("This workspace")).toBeVisible();
		await expect.element(page.getByText("Other workbooks")).toBeVisible();
		const rows = [
			...page
				.getByTestId("workbooks-picker")
				.element()
				.querySelectorAll("[data-qa-id^='workbooks-continue-']"),
		].map((row) => row.getAttribute("data-qa-id"));
		expect(rows).toEqual([`workbooks-continue-${here.id}`, `workbooks-continue-${elsewhere.id}`]);
	});

	it("lists only one group, without headings, when there's no split", async () => {
		const { host } = await renderSection();
		await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "blank",
			name: "Only here",
			values: { goal: "g" },
		});

		await openPicker();

		await expect.element(page.getByText("Only here")).toBeVisible();
		await expect.element(page.getByText("This workspace")).not.toBeInTheDocument();
	});

	it("works without a workspace: lists every workbook and creates new ones outside any", async () => {
		const { host, log } = await renderSection({ workspaceId: null });
		const existing = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "blank",
			name: "From a workspace",
			values: { goal: "g" },
		});

		await openPicker();
		await expect.element(page.getByTestId(`workbooks-continue-${existing.id}`)).toBeVisible();
		await expect.element(page.getByText("This workspace")).not.toBeInTheDocument();
		await userEvent.click(page.getByTestId("workbooks-new"));
		await userEvent.click(page.getByTestId("workbooks-template-blank"));
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Scratch");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Poke at things");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(() => log.opened).toEqual(["wses_1"]);
		const created = host.renderer.kernelSdk.domainObjects
			.get(Workbooks)!
			.getState()
			.workbooks.find((workbook) => workbook.name === "Scratch");
		expect(created?.usedIn).toEqual([]);
	});
});
