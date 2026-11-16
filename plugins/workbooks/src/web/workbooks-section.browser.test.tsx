import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { SessionWorkbooks, Workbooks } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { NewWorkSessionSection } from "@kilo-desktop/plugin-work-sessions/contracts";

import { bootWorkbooks, pageStart, type PageStarts, type StartedChat } from "../test/hosts";

const hosts: PluginHost[] = [];
const slots: { unmount(): void }[] = [];

afterEach(async () => {
	slots.splice(0).forEach((slot) => slot.unmount());
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function renderSection(options: { pages?: FakePages; workspaceId?: string | null } = {}) {
	const started: StartedChat[] = [];
	const log: PageStarts = { opened: [], discarded: [] };
	const booted = await bootWorkbooks({
		started,
		...(options.pages ? { pages: options.pages } : {}),
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

describe("Start from a workbook on the New Session page", () => {
	it("creates a workbook from the Coding template and starts a session on it", async () => {
		const { host, started, log, pages } = await renderSection();

		await userEvent.click(page.getByTestId("workbooks-new"));
		await expect.element(page.getByTestId("workbooks-new-form")).toBeVisible();
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

	it("asks for a template, then that template's Brief", async () => {
		const { host, started } = await renderSection();

		await userEvent.click(page.getByTestId("workbooks-new"));
		await expect.element(page.getByTestId("workbooks-template-coding")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-field-acceptance")).toBeVisible();
		await userEvent.click(page.getByTestId("workbooks-template-blank"));
		await expect.element(page.getByTestId("workbooks-field-acceptance")).not.toBeInTheDocument();
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Scratch");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "Poke at things");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(() => started.length).toBe(1);
		const [workbook] = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(workbook).toMatchObject({ templateId: "blank", name: "Scratch" });
		expect(workbook!.sections.map((section) => section.id)).toEqual(["notes"]);
		expect(started[0]!.text).toContain("adding anything worth keeping to Notes");
	});

	it("shows why a workbook couldn't be created, starting no session", async () => {
		const pages = new FakePages();
		pages.failOn = "create_project";
		const { log } = await renderSection({ pages });
		await userEvent.click(page.getByTestId("workbooks-new"));

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
