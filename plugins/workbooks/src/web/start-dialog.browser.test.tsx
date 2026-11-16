import { render, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelProvider } from "@kilo-desktop/kernel/web";
import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { SessionWorkbooks, Workbooks } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { bootWorkbooks, type StartedChat } from "../test/hosts";
import { StartWorkbookDialog } from "./StartWorkbookDialog";
import { WorkbooksButton } from "./WorkbooksButton";

const hosts: PluginHost[] = [];
const views: RenderResult[] = [];

afterEach(async () => {
	views.splice(0).forEach((view) => view.unmount());
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function renderDialog(options: { pages?: FakePages } = {}) {
	const started: StartedChat[] = [];
	const booted = await bootWorkbooks({ started, ...options });
	hosts.push(booted.host);
	const close = vi.fn();
	views.push(
		render(
			<KernelProvider kernel={booted.host.renderer}>
				<StartWorkbookDialog close={close} input={undefined} />
			</KernelProvider>,
		),
	);
	return { ...booted, started, close };
}

describe("Start from a workbook", () => {
	it("creates a workbook from the Coding template and starts a session on it", async () => {
		const { host, started, close, pages } = await renderDialog();

		await expect.element(page.getByTestId("workbooks-new-form")).toBeVisible();
		await expect.element(page.getByTestId("workbooks-create")).toBeDisabled();
		await userEvent.fill(page.getByTestId("workbooks-name").element(), "Fix the server bug");
		await userEvent.fill(
			page.getByTestId("workbooks-field-goal").element(),
			"Fix the bug in the server",
		);
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.poll(() => close.mock.calls.length).toBe(1);
		const workbooks = host.renderer.kernelSdk.domainObjects.get(Workbooks)!.getState().workbooks;
		expect(workbooks.map((workbook) => workbook.name)).toEqual(["Fix the server bug"]);
		expect(pages.projects.size).toBe(1);
		expect(started[0]!.text).toContain('"Fix the server bug"');
		const sessions = host.renderer.kernelSdk.domainObjects.get(SessionWorkbooks)!;
		await expect.poll(() => sessions.getState().bySession).toEqual({ wses_1: workbooks[0]!.id });
	});

	it("continues a workbook already in the workspace", async () => {
		const { host, started, close } = await renderDialog();
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Existing",
			values: { goal: "g" },
		});

		await userEvent.click(page.getByTestId("workbooks-tab-continue"));
		await userEvent.click(page.getByTestId(`workbooks-continue-${workbook.id}`));

		await expect.poll(() => close.mock.calls.length).toBe(1);
		expect(started[0]!.text).toContain('"Existing"');
	});

	it("shows why a workbook couldn't be created, and stays open", async () => {
		const pages = new FakePages();
		pages.failOn = "create_project";
		const { close } = await renderDialog({ pages });

		await userEvent.fill(page.getByTestId("workbooks-name").element(), "X");
		await userEvent.fill(page.getByTestId("workbooks-field-goal").element(), "g");
		await userEvent.click(page.getByTestId("workbooks-create"));

		await expect.element(page.getByTestId("workbooks-start-error")).toBeVisible();
		expect(close).not.toHaveBeenCalled();
	});

	it("explains an empty workspace", async () => {
		await renderDialog();

		await userEvent.click(page.getByTestId("workbooks-tab-continue"));

		await expect.element(page.getByTestId("workbooks-none")).toBeVisible();
	});
});

describe("the session list's Workbooks button", () => {
	it("opens Start from a workbook", async () => {
		const dialogs: string[] = [];
		const booted = await bootWorkbooks({ dialogs });
		hosts.push(booted.host);
		views.push(
			render(
				<KernelProvider kernel={booted.host.renderer}>
					<WorkbooksButton />
				</KernelProvider>,
			),
		);

		await userEvent.click(page.getByTestId("session-list-workbooks"));

		await expect.poll(() => dialogs).toEqual(["kilo.workbooks/start"]);
	});
});
