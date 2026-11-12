import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { RenderContribution } from "@kilo-desktop/kernel/web";
import {
	PermissionRenderer,
	type PermissionDetailProps,
	type PermissionInteraction,
	type PermissionRendererImplementation,
} from "@kilo-desktop/plugin-chat/contracts";
import type { Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import { bootNotebookHost, NOTEBOOK_ID, type NotebookTestHost } from "../test/notebook-host";
import { notebookPane } from "../test/sessions-host";

const selectDetail = (implementation: PermissionRendererImplementation) =>
	implementation.PermissionDetail;

function executeRenderer(host: NotebookTestHost) {
	return host.renderer.extensions
		.list(PermissionRenderer)
		.find((candidate) => candidate.key === "kilo.notebook/execute")!;
}

function executeRequest(
	args: Record<string, unknown>,
	metadata: Record<string, unknown> = {},
): PermissionInteraction {
	return { permission: "notebooks_execute", patterns: [NOTEBOOK_ID], args, metadata };
}

async function renderDetail(request: PermissionInteraction, panes?: readonly Pane[]) {
	const host = await bootNotebookHost(panes ? { panes } : {});
	const contribution = executeRenderer(host);
	const { baseElement } = host.render(
		<RenderContribution<PermissionDetailProps>
			contribution={contribution}
			props={{ request }}
			select={selectDetail}
		/>,
	);
	return { contribution, baseElement, screen: page.elementLocator(baseElement) };
}

describe("kilo.notebook's notebook code permission card", () => {
	it("shows the code a run_cell call will execute", async () => {
		const { contribution, screen } = await renderDetail(
			executeRequest({ notebook_id: "nb", code: "import os\nos.remove('data.csv')" }),
		);

		expect(contribution.metadata.permissions).toEqual(["notebooks_execute"]);
		await expect
			.element(screen.getByTestId("notebook-execute-code"))
			.toHaveTextContent("import os os.remove('data.csv')");
	});

	it("shows the source of a cell create_cell will run", async () => {
		const { screen } = await renderDetail(
			executeRequest({ notebook_id: "nb", source: "print('hi')", and_run: true }),
		);

		await expect
			.element(screen.getByTestId("notebook-execute-code"))
			.toHaveTextContent("print('hi')");
	});

	it("names the cell an execute call will run by its number", async () => {
		const { screen } = await renderDetail(
			executeRequest(
				{ notebook_id: "nb", cell_ids: ["cell-1"] },
				{ action: "execute", cell_ids: ["cell-1"], cell_numbers: [4], all_cells: false },
			),
		);

		const cells = screen.getByTestId("notebook-execute-cells");
		await expect.element(cells.getByText("Cell", { exact: true })).toBeVisible();
		await expect.element(cells.getByText("4", { exact: true })).toBeVisible();
		await expect.element(cells.getByText(/cell-1/)).not.toBeInTheDocument();
	});

	it("lists the numbers of the cells an execute call will run", async () => {
		const { screen } = await renderDetail(
			executeRequest(
				{ notebook_id: "nb", cell_ids: ["cell-1", "cell-2", "cell-3"] },
				{
					action: "execute",
					cell_ids: ["cell-1", "cell-2", "cell-3"],
					cell_numbers: [4, 6, 9],
					all_cells: false,
				},
			),
		);

		const cells = screen.getByTestId("notebook-execute-cells");
		await expect.element(cells.getByText("Cells", { exact: true })).toBeVisible();
		await expect.element(cells.getByText("4, 6, 9")).toBeVisible();
	});

	it("counts the cells of a run of all code cells instead of listing them", async () => {
		const { screen } = await renderDetail(
			executeRequest(
				{ notebook_id: "nb" },
				{ action: "execute", cell_ids: ["a", "b"], cell_numbers: [2, 5], all_cells: true },
			),
		);

		await expect
			.element(screen.getByTestId("notebook-execute-cells").getByText("All 2 code cells"))
			.toBeVisible();
	});

	it("names the notebook by its file instead of showing its id", async () => {
		const request = executeRequest({ notebook_id: NOTEBOOK_ID, action: "restart" });
		const { contribution, screen } = await renderDetail(request, [
			notebookPane("pane_a", { notebookId: NOTEBOOK_ID, notebookPath: "/work/analysis.ipynb" }),
		]);

		expect(
			(contribution.implementation as PermissionRendererImplementation).showPatterns?.(request),
		).toBe(false);
		await expect
			.element(screen.getByTestId("notebook-execute-notebook").getByText("/work/analysis.ipynb"))
			.toBeVisible();
	});

	it("names an unsaved notebook by its tab title", async () => {
		const { screen } = await renderDetail(
			executeRequest({ notebook_id: NOTEBOOK_ID, action: "restart" }),
			[{ ...notebookPane("pane_a", { notebookId: NOTEBOOK_ID }), title: "Untitled notebook" }],
		);

		await expect
			.element(screen.getByTestId("notebook-execute-notebook").getByText("Untitled notebook"))
			.toBeVisible();
	});

	it("shows nothing extra when the call has no code or cells", async () => {
		const { baseElement } = await renderDetail(
			executeRequest({ notebook_id: "nb", action: "restart" }, { action: "restart" }),
		);

		await expect
			.poll(() => baseElement.querySelector('[data-qa-id^="notebook-execute-"]'))
			.toBeNull();
	});
});
