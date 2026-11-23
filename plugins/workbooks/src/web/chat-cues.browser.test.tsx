import { render, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelOs } from "@kilo-desktop/kernel";
import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { WorkSessionAction, type WorkSession } from "@kilo-desktop/plugin-work-sessions/contracts";

import { SessionWorkbooks, Workbooks } from "../contracts";
import { bootWorkbooks } from "../test/hosts";
import { FilingReceipt } from "./FilingReceipt";

const hosts: PluginHost[] = [];
const views: RenderResult[] = [];

afterEach(async () => {
	views.splice(0).forEach((view) => view.unmount());
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

const session = (id: string) => ({ id }) as WorkSession;

describe("the session header's workbook chip", () => {
	it("shows the session's workbook and opens it", async () => {
		const opened: string[] = [];
		const { host } = await bootWorkbooks();
		hosts.push(host);
		host.main.kernelSdk.domainObjects.provide(KernelOs, {
			initialState: {},
			methods: {
				openExternal: ({ url }) => {
					opened.push(url);
					return true;
				},
				showItemInFolder: () => undefined,
				showLogs: () => ({ revealed: false }),
				logFilePath: () => "",
			},
		});
		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Fix the server bug",
			values: { goal: "g" },
		});
		await host.invoke(SessionWorkbooks, "setActive", {
			workSessionId: "wses_1",
			workbookId: workbook.id,
		});

		const withWorkbook = host.renderSlot(WorkSessionAction, { workSession: session("wses_1") });
		const without = host.renderSlot(WorkSessionAction, { workSession: session("wses_2") });

		await expect
			.element(page.getByTestId("workbooks-chip"))
			.toHaveTextContent("Fix the server bug");
		expect(withWorkbook.container.querySelector('[data-qa-id="workbooks-chip"]')).not.toBeNull();
		expect(without.container.querySelector('[data-qa-id="workbooks-chip"]')).toBeNull();
		await userEvent.click(page.getByTestId("workbooks-chip"));
		await expect.poll(() => opened).toEqual([workbook.url]);
	});
});

describe("filing receipts", () => {
	it("show a workbook tool call as one line, marking running and failed calls", async () => {
		const Original = () => null;
		const base = { toolCallId: "t", argsText: "", Original };
		views.push(
			render(
				<>
					<FilingReceipt
						{...base}
						toolName="desktop_workbooks_add_item"
						args={{ section: "decisions", text: "Use SSE" }}
						status={{ type: "complete" }}
					/>
					<FilingReceipt
						{...base}
						toolName="desktop_workbooks_add_task"
						args={{ step: "2", text: "x" }}
						status={{ type: "running" }}
					/>
					<FilingReceipt
						{...base}
						toolName="desktop_workbooks_answer_question"
						args={{}}
						status={{ type: "incomplete" }}
					/>
				</>,
			),
		);

		const receipts = page.getByTestId("workbooks-receipt").elements();
		expect(receipts.map((receipt) => receipt.textContent)).toEqual([
			"→ Added to decisions: Use SSE",
			"Added task to plan step 2: x",
			"Couldn't answer the question",
		]);
		expect(receipts.map((receipt) => receipt.getAttribute("data-state"))).toEqual([
			"done",
			"running",
			"failed",
		]);
	});
});
