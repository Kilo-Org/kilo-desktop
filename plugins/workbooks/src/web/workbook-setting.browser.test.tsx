import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { definePlugin } from "@kilo-desktop/kernel";

import { SessionWorkbooks, WorkbookTemplatePoint, Workbooks } from "../contracts";
import { FakePages } from "../test/fake-pages";
import {
	NewWorkSessionSettingPoint,
	type NewWorkSessionSetting,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { bootWorkbooks, type GuestPlugin, type NewSessionDraft } from "../test/hosts";

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
							guide: "Be good.",
							pages: [
								{ title: "Brief", home: true, sections: [{ type: "goal" }] },
								{ title: "Notes", sections: [{ type: "log", collects: "Notes." }] },
							],
						}),
					});
				}
			},
		}),
	};
}

async function renderSetting(
	options: {
		pages?: FakePages;
		workspaceId?: string | null;
		others?: readonly GuestPlugin[];
	} = {},
) {
	const draft: NewSessionDraft = { text: "" };
	const booted = await bootWorkbooks({
		draft,
		...(options.pages ? { pages: options.pages } : {}),
		...(options.others ? { others: options.others } : {}),
	});
	hosts.push(booted.host);
	slots.push(
		booted.host.renderSlot(
			NewWorkSessionSettingPoint,
			{
				workspaceId: options.workspaceId === undefined ? "ws-1" : options.workspaceId,
				directory: options.workspaceId === null ? null : "/repo",
				disabled: false,
			},
			{ select: (setting: NewWorkSessionSetting) => setting.component },
		),
	);
	await expect.element(page.getByTestId("workbooks-picker-trigger")).toBeVisible();
	const objects = booted.host.renderer.kernelSdk.domainObjects;
	const setting = booted.host.renderer.kernelSdk.extensions.list(NewWorkSessionSettingPoint)[0]!
		.implementation!;
	/** Starts a session as the New Session page does, returning the workbook it was put in. */
	const startSession = async (workSessionId = "wses_1") => {
		await setting.apply({ workSessionId, workspaceId: "ws-1", directory: "/repo" });
		return objects.get(SessionWorkbooks)!.lookup(workSessionId) ?? null;
	};
	return { ...booted, startSession, draft };
}

const trigger = () => page.getByTestId("workbooks-picker-trigger").element().textContent;

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

describe("the Workbook setting on the New Session page", () => {
	it("creates a workbook from the Coding template and selects it, starting nothing", async () => {
		const { host, pages, startSession } = await renderSetting();

		await newWorkbook();
		await expect.element(page.getByTestId("workbooks-create")).toBeDisabled();
		await expect.element(page.getByTestId("workbooks-create")).toHaveTextContent("Create workbook");
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Fix the server bug");
		await userEvent.fill(
			page.getByTestId("workbooks-field-goal").element(),
			"Fix the bug in the server",
		);
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.element(page.getByTestId("workbooks-new-dialog")).not.toBeInTheDocument();
		await expect.poll(trigger).toContain("Fix the server bug");
		const sessions = host.renderer.kernelSdk.domainObjects.get(SessionWorkbooks)!;
		expect(sessions.getState().bySession).toEqual({});
		const workbooks = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(workbooks.map((workbook) => workbook.name)).toEqual(["Fix the server bug"]);
		expect(pages.projects.size).toBe(1);

		await expect(startSession()).resolves.toBe(workbooks[0]!.id);
	});
	it("puts each session the page starts in the chosen workbook, until it's cleared", async () => {
		const { host, startSession } = await renderSetting();
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Existing",
			values: { goal: "g" },
		});
		await expect.poll(trigger).toBe("None");
		await expect(startSession("wses_0")).resolves.toBeNull();

		await openPicker();
		await expect.element(page.getByTestId("workbooks-none")).not.toBeInTheDocument();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));

		await expect.element(page.getByTestId("workbooks-picker")).not.toBeInTheDocument();
		await expect.poll(trigger).toContain("Existing");
		await openPicker();
		await expect
			.element(page.getByTestId(`workbooks-continue-${workbook.id}`))
			.toHaveAttribute("data-checked", "true");
		await userEvent.keyboard("{Escape}");
		await expect(startSession("wses_1")).resolves.toBe(workbook.id);
		await expect(startSession("wses_2")).resolves.toBe(workbook.id);

		await openPicker();
		await userEvent.click(page.getByTestId("workbooks-none"));

		await expect.poll(trigger).toBe("None");
		await expect(startSession("wses_3")).resolves.toBeNull();
	});
	it("suggests the first message: the first move for a workbook just made, else carry on", async () => {
		const { host, draft, startSession } = await renderSetting();
		const existing = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Existing",
			values: { goal: "g" },
		});

		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${existing.id}`));
		await expect
			.poll(() => draft.text)
			.toBe(`Let's carry on with workbook "Existing": say where we left off and what's next.`);

		await newWorkbook();
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Clock");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Show the time");
		await userEvent.click(page.getByTestId("workbooks-create"));
		await expect
			.poll(() => draft.text)
			.toMatch(/^Let's start the workbook "Clock". Refine the Brief/);

		// Once a session has started on it, it's no longer new.
		await startSession();
		draft.text = "";
		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${existing.id}`));
		await openPicker();
		const clock = host.renderer.kernelSdk.domainObjects
			.get(Workbooks)!
			.getState()
			.workbooks.find((workbook) => workbook.name === "Clock")!;
		await userEvent.click(page.getByTestId(`workbooks-continue-${clock.id}`));
		await expect.poll(() => draft.text).toMatch(/^Let's carry on with workbook "Clock"/);

		await openPicker();
		await userEvent.click(page.getByTestId("workbooks-none"));
		await expect.poll(() => draft.text).toBe("");
	});

	it("never replaces what the person typed", async () => {
		const { host, draft } = await renderSetting();
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Existing",
			values: { goal: "g" },
		});
		draft.text = "My own words";

		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));
		await expect.poll(trigger).toContain("Existing");

		expect(draft.text).toBe("My own words");
	});

	it("asks for a template first, then that template's Brief, with Back to the templates", async () => {
		const { host } = await renderSetting();

		await openNewWorkbook();
		await expect.element(page.getByTestId("workbooks-template-coding")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-template-blank")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-template-filter")).not.toBeInTheDocument();
		await userEvent.click(page.getByTestId("workbooks-template-coding"));
		await expect.poll(() => moreDetails()).toMatch(/Context and links\W+optional$/);
		await expect
			.element(page.getByTestId("workbooks-field-context-and-links"))
			.not.toBeInTheDocument();
		await userEvent.click(page.getByTestId("workbooks-back"));
		await userEvent.click(page.getByTestId("workbooks-template-blank"));
		await expect.element(page.getByTestId("workbooks-more-details")).not.toBeInTheDocument();
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Scratch");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Poke at things");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(trigger).toContain("Scratch");
		const [workbook] = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(workbook).toMatchObject({ templateId: "blank", name: "Scratch" });
		expect(workbook!.sections.map((section) => section.id)).toEqual(["goal", "handoff", "notes"]);
	});

	it("lists workbooks with their template, and searches them", async () => {
		const { host } = await renderSetting();
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
		await renderSetting({
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
		const { host, pages } = await renderSetting();

		await newWorkbook();
		await userEvent.click(page.getByTestId("workbooks-more-details"));
		await userEvent.fill(
			page.getByTestId("workbooks-field-context-and-links").element(),
			"Issue #42",
		);
		await expect.poll(() => moreDetails()).toMatch(/1 filled in$/);
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Clock");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Show the time");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect
			.poll(() => host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks.length)
			.toBe(1);
		const [workbook] = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(pages.markdown(pages.documentOf(workbook!.projectId))).toContain(
			"## Context and links\n\n_Where things are: the issue, upstream references, entry points in the code, the branch and PR once they exist, local tools and environments._\n\nIssue #42",
		);
	});

	it("shows why a workbook couldn't be created, selecting nothing", async () => {
		const pages = new FakePages();
		pages.failOn = "create_project";
		await renderSetting({ pages });
		await newWorkbook();

		await userEvent.fill(page.getByTestId("workbooks-name").element(), "X");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "g");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.element(page.getByTestId("workbooks-start-error")).toBeVisible();
		expect(trigger()).toBe("None");
		await expect.element(page.getByTestId("workbooks-new-dialog")).toBeVisible();
	});

	it("offers New workbook in an empty picker, and closes the wizard on Cancel", async () => {
		await renderSetting();

		await openPicker();
		await expect.element(page.getByText("No workbooks yet.")).toBeVisible();
		await userEvent.click(page.getByTestId("workbooks-new"));
		await expect.element(page.getByTestId("workbooks-new-dialog")).toBeVisible();
		await userEvent.click(page.getByRole("button", { name: "Cancel" }));
		await expect.element(page.getByTestId("workbooks-new-dialog")).not.toBeInTheDocument();
	});

	it("drops the selection when the workbook is forgotten", async () => {
		const renderedSoonGone = await renderSetting();
		const { host } = renderedSoonGone;
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Soon gone",
			values: { goal: "g" },
		});
		const { startSession } = renderedSoonGone;
		await openPicker();
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));
		await expect.poll(trigger).toContain("Soon gone");
		await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Stays",
			values: { goal: "g" },
		});

		await host.invoke(Workbooks, "forget", { id: workbook.id });

		await expect.poll(trigger).toBe("None");
		await expect(startSession()).resolves.toBeNull();
	});

	it("opens the picker from the keyboard", async () => {
		const { host } = await renderSetting();
		await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "blank",
			name: "Any",
			values: { goal: "g" },
		});
		await expect.element(page.getByTestId("workbooks-picker-trigger")).toBeVisible();

		page.getByTestId("workbooks-picker-trigger").element().focus();
		await userEvent.keyboard("{ArrowDown}");

		await expect.element(page.getByTestId("workbooks-picker")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("workbooks-picker")).not.toBeInTheDocument();
	});

	it("puts the workspace's workbooks first, then the others under their own heading", async () => {
		const { host } = await renderSetting();
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

		await expect.element(page.getByText("Used before in this workspace")).toBeVisible();
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
		const { host } = await renderSetting();
		await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "blank",
			name: "Only here",
			values: { goal: "g" },
		});

		await openPicker();

		await expect.element(page.getByText("Only here")).toBeVisible();
		await expect.element(page.getByText("Used before in this workspace")).not.toBeInTheDocument();
	});

	it("works without a workspace: lists every workbook and creates new ones outside any", async () => {
		const { host } = await renderSetting({ workspaceId: null });
		const existing = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "blank",
			name: "From a workspace",
			values: { goal: "g" },
		});

		await openPicker();
		await expect.element(page.getByTestId(`workbooks-continue-${existing.id}`)).toBeVisible();
		await expect.element(page.getByText("Used before in this workspace")).not.toBeInTheDocument();
		await userEvent.click(page.getByTestId("workbooks-new"));
		await userEvent.click(page.getByTestId("workbooks-template-blank"));
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Scratch");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Poke at things");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(trigger).toContain("Scratch");
		const created = host.renderer.kernelSdk.domainObjects
			.get(Workbooks)!
			.getState()
			.workbooks.find((workbook) => workbook.name === "Scratch");
		expect(created?.usedIn).toEqual([]);
	});

	it("finds workbooks made elsewhere in Pages when it shows", async () => {
		const pages = new FakePages();
		const projectId = pages.addProject("From the old laptop", "Workbook · Spike · workspace: W", [
			"Decisions",
		]);
		pages.addProject("Holiday plans", "Not a workbook");
		await renderSetting({ pages });

		await openPicker();

		await expect
			.poll(() => page.getByTestId(`workbooks-continue-${projectId}`).element().textContent)
			.toContain("From the old laptopSpike");
		await expect.element(page.getByText("Holiday plans")).not.toBeInTheDocument();
	});

	it("says why it couldn't read the workbooks from Pages", async () => {
		const pages = new FakePages();
		pages.failOn = "list_projects";
		await renderSetting({ pages });

		await openPicker();

		await expect
			.element(page.getByText(/Couldn't read your workbooks from Pages: .*list_projects failed/))
			.toBeVisible();
	});
});
