import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createNteractKiloPlugin } from "./index.js";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";

function toolContext(overrides: Partial<{ abort: AbortSignal; worktree: string }> = {}) {
	return {
		sessionID: "kilo-session-1",
		messageID: "message-1",
		agent: "build",
		directory: "/projects/demo",
		worktree: overrides.worktree ?? "/projects/demo",
		abort: overrides.abort ?? new AbortController().signal,
		metadata: vi.fn(),
		ask: vi.fn(async () => undefined),
	};
}

describe("nteract Kilo plugin", () => {
	it("creates a notebook cell through a dedicated tool and can execute it immediately", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			createCell: vi.fn(async () => "cell-created"),
			executeCell: vi.fn(async () => ({
				cellId: "cell-created",
				executionId: "execution-created",
				executionCount: 4,
				status: "done",
				success: true,
				outputs: [{ outputType: "stream", name: "stdout", text: "created\n" }],
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();

		const result = await hooks.tool.notebooks_create_cell.execute(
			{
				notebook_id: NOTEBOOK_ID,
				source: "print('created')",
				cell_type: "code",
				after_cell_id: "cell-1",
				and_run: true,
				timeout_secs: 30,
			},
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(hooks.tool.notebooks_create_cell.description).toMatch(/^Create a notebook cell/);
		expect(session.createCell).toHaveBeenCalledWith("print('created')", {
			cellType: "code",
			afterCellId: "cell-1",
		});
		expect(session.executeCell).toHaveBeenCalledWith("cell-created", { timeoutMs: 30_000 });
		expect(result).toEqual({
			title: "Notebook cell created and executed",
			output: "cell cell-created [4] done\ncreated",
			metadata: {
				notebook_id: NOTEBOOK_ID,
				cell_id: "cell-created",
				execution_id: "execution-created",
				execution_count: 4,
				status: "done",
				success: true,
			},
		});
	});

	it("runs a visible notebook cell and returns text and image output", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			runCell: vi.fn(async () => ({
				cellId: "cell-7",
				executionId: "execution-7",
				executionCount: 7,
				status: "done",
				success: true,
				outputs: [
					{ outputType: "stream", name: "stdout", text: "answer: 42\n" },
					{
						outputType: "display_data",
						dataJson: JSON.stringify({
							"image/png": { type: "binary", value: "AAAA" },
							"text/plain": { type: "text", value: "<Figure size 640x480>" },
						}),
					},
				],
			})),
			close: vi.fn(async () => undefined),
		};
		const openNotebook = vi.fn(async () => session);
		const plugin = createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		});
		const hooks = await plugin();

		const result = await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "print('answer:', 42)" },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(result).toEqual({
			title: "Notebook cell 7",
			output: "cell cell-7 [7] done\nanswer: 42",
			metadata: {
				notebook_id: NOTEBOOK_ID,
				cell_id: "cell-7",
				execution_id: "execution-7",
				execution_count: 7,
				status: "done",
				success: true,
			},
			attachments: [{ type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" }],
		});
		expect(openNotebook).toHaveBeenCalledWith(NOTEBOOK_ID, {
			description: "Kilo Desktop notebook tools",
			peerLabel: "Kilo Desktop",
		});
	});

	it("reads notebook cells with their current execution results", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			listCells: vi.fn(async () => [
				{
					id: "cell-1",
					cellType: "code",
					position: "a0",
					source: "40 + 2",
					metadataJson: "{}",
				},
			]),
			getCell: vi.fn(),
			getExecutionView: vi.fn(() => ({
				cell_execution_ids: { "cell-1": "execution-1" },
				executions: {
					"execution-1": {
						execution_count: 1,
						status: "done",
						success: true,
						output_ids: ["output-1"],
					},
				},
				queue: null,
			})),
			close: vi.fn(async () => undefined),
		};
		const getExecutionResult = vi.fn(async () => ({
			cellId: "cell-1",
			executionId: "execution-1",
			executionCount: 1,
			status: "done",
			success: true,
			outputs: [{ outputType: "execute_result", dataJson: "{}" }],
		}));
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult,
			}),
		})();

		const result = await hooks.tool.notebooks_read.execute(
			{ notebook_id: NOTEBOOK_ID, include_outputs: true },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(JSON.parse(result.output)).toEqual({
			notebook_id: NOTEBOOK_ID,
			cells: [
				{
					id: "cell-1",
					cell_type: "code",
					position: "a0",
					source: "40 + 2",
					metadata: {},
					execution: {
						execution_id: "execution-1",
						execution_count: 1,
						status: "done",
						success: true,
						outputs: [{ outputType: "execute_result", dataJson: "{}" }],
					},
				},
			],
		});
		expect(result.title).toBe("Notebook contents");
		expect(getExecutionResult).toHaveBeenCalledWith("execution-1");
	});

	it("applies an ordered batch of notebook cell edits", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async () => true),
			deleteCell: vi.fn(async () => true),
			moveCell: vi.fn(async () => "a2"),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();

		const result = await hooks.tool.notebooks_edit_cells.execute(
			{
				notebook_id: NOTEBOOK_ID,
				operations: [
					{ action: "update", cell_id: "cell-2", source: "value = 42" },
					{ action: "move", cell_id: "cell-2", after_cell_id: "cell-1" },
					{ action: "delete", cell_id: "cell-3" },
				],
			},
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(JSON.parse(result.output)).toEqual({
			notebook_id: NOTEBOOK_ID,
			results: [
				{ action: "update", cell_id: "cell-2", updated: true },
				{ action: "move", cell_id: "cell-2", position: "a2" },
				{ action: "delete", cell_id: "cell-3", deleted: true },
			],
		});
		expect(session.setCell).toHaveBeenCalledWith("cell-2", { source: "value = 42" });
		expect(session.moveCell).toHaveBeenCalledWith("cell-2", "cell-1");
		expect(
			z.safeParse(hooks.tool.notebooks_edit_cells.args.operations!, [
				{ action: "create", source: "# Analysis", cell_type: "markdown" },
			]).success,
		).toBe(false);
	});

	it("executes selected existing cells in order and combines their results", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			executeCell: vi
				.fn()
				.mockResolvedValueOnce({
					cellId: "cell-1",
					executionId: "execution-1",
					executionCount: 1,
					status: "done",
					success: true,
					outputs: [{ outputType: "stream", name: "stdout", text: "one\n" }],
				})
				.mockResolvedValueOnce({
					cellId: "cell-2",
					executionId: "execution-2",
					executionCount: 2,
					status: "done",
					success: true,
					outputs: [{ outputType: "stream", name: "stdout", text: "two\n" }],
				}),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();

		const result = await hooks.tool.notebooks_execute.execute(
			{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1", "cell-2"], timeout_secs: 30 },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(result.output).toBe("cell cell-1 [1] done\none\n\ncell cell-2 [2] done\ntwo");
		expect(result.metadata).toEqual({
			notebook_id: NOTEBOOK_ID,
			cell_ids: ["cell-1", "cell-2"],
			execution_ids: ["execution-1", "execution-2"],
			status: "done",
		});
		expect(session.executeCell).toHaveBeenNthCalledWith(1, "cell-1", { timeoutMs: 30_000 });
		expect(session.executeCell).toHaveBeenNthCalledWith(2, "cell-2", { timeoutMs: 30_000 });
	});

	it("edits notebook dependencies and synchronizes the environment", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			addDependencies: vi.fn(async () => undefined),
			syncEnvironment: vi.fn(async () => undefined),
			getDependencyStatus: vi.fn(async () => ({
				uv: { dependencies: ["polars>=1"] },
				fingerprint: "environment-2",
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();

		const result = await hooks.tool.notebooks_dependencies.execute(
			{
				notebook_id: NOTEBOOK_ID,
				action: "add",
				packages: ["polars>=1"],
				package_manager: "uv",
			},
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(session.addDependencies).toHaveBeenCalledWith(["polars>=1"], {
			packageManager: "uv",
		});
		expect(session.syncEnvironment).toHaveBeenCalledOnce();
		expect(JSON.parse(result.output)).toEqual({
			notebook_id: NOTEBOOK_ID,
			action: "add",
			status: { uv: { dependencies: ["polars>=1"] }, fingerprint: "environment-2" },
		});
	});

	it("controls the notebook kernel and reports its resulting status", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			restartKernel: vi.fn(async () => undefined),
			getRuntimeStatus: vi.fn(async () => ({
				status: "idle",
				lifecycle: "ready",
				startingPhase: "ready",
				name: "python",
				language: "python",
				envSource: "uv",
				runtimeAgentId: "runtime-1",
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();

		const result = await hooks.tool.notebooks_kernel.execute(
			{ notebook_id: NOTEBOOK_ID, action: "restart" },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		expect(session.restartKernel).toHaveBeenCalledOnce();
		expect(JSON.parse(result.output)).toEqual({
			notebook_id: NOTEBOOK_ID,
			action: "restart",
			status: {
				status: "idle",
				lifecycle: "ready",
				startingPhase: "ready",
				name: "python",
				language: "python",
				envSource: "uv",
				runtimeAgentId: "runtime-1",
			},
		});
	});

	it("saves a notebook to a path inside the Kilo workspace", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();
		const ask = vi.fn(async () => undefined);

		const result = await hooks.tool.notebooks_save.execute(
			{ notebook_id: NOTEBOOK_ID, path: "reports/analysis.ipynb" },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask,
			},
		);

		expect(session.saveNotebook).toHaveBeenCalledWith("/projects/demo/reports/analysis.ipynb");
		expect(ask).not.toHaveBeenCalled();
		expect(result).toEqual({
			title: "Notebook saved",
			output: "/projects/demo/reports/analysis.ipynb",
			metadata: {
				notebook_id: NOTEBOOK_ID,
				path: "/projects/demo/reports/analysis.ipynb",
			},
		});
	});

	it("asks before saving a notebook outside the Kilo workspace", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();
		const ask = vi.fn(async () => undefined);

		await hooks.tool.notebooks_save.execute(
			{ notebook_id: NOTEBOOK_ID, path: "/exports/analysis.ipynb" },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask,
			},
		);

		expect(ask).toHaveBeenCalledWith({
			permission: "external_directory",
			patterns: ["/exports/analysis.ipynb"],
			always: [],
			metadata: { notebook_id: NOTEBOOK_ID, path: "/exports/analysis.ipynb" },
		});
		expect(session.saveNotebook).toHaveBeenCalledWith("/exports/analysis.ipynb");
	});

	it("asks before approving notebook environment trust", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			approveTrust: vi.fn(async () => undefined),
			getDependencyStatus: vi.fn(async () => ({ fingerprint: "environment-1" })),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();
		const ask = vi.fn(async () => undefined);

		await hooks.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "approve_trust", observed_heads: ["head-1"] },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask,
			},
		);

		expect(ask).toHaveBeenCalledWith({
			permission: "notebooks_trust",
			patterns: [NOTEBOOK_ID],
			always: [NOTEBOOK_ID],
			metadata: { notebook_id: NOTEBOOK_ID, observed_heads: ["head-1"] },
		});
		expect(session.approveTrust).toHaveBeenCalledWith(["head-1"]);
	});

	it("closes native notebook peers when their Kilo session is deleted", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			runCell: vi.fn(async () => ({
				cellId: "cell-1",
				executionId: "execution-1",
				status: "done",
				success: true,
				outputs: [],
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		})();
		await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "1 + 1" },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "build",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				abort: new AbortController().signal,
				metadata: vi.fn(),
				ask: vi.fn(async () => undefined),
			},
		);

		await hooks.event?.({
			event: { type: "session.deleted", properties: { sessionID: "kilo-session-1" } },
		});

		expect(session.close).toHaveBeenCalledOnce();
	});

	it("rejects a runtimed module that does not export openNotebook", async () => {
		await expect(createNteractKiloPlugin({ loadRuntimedNode: () => ({}) })()).rejects.toThrow(
			/does not export openNotebook/,
		);
		await expect(createNteractKiloPlugin({ loadRuntimedNode: () => null })()).rejects.toThrow(
			/did not export a module object/,
		);
	});

	it("retries a failed notebook open instead of caching the rejection", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			runCell: vi.fn(async () => ({
				cellId: "cell-1",
				executionId: "execution-1",
				status: "done",
				success: true,
				outputs: [],
			})),
			close: vi.fn(async () => undefined),
		};
		const openNotebook = vi
			.fn()
			.mockRejectedValueOnce(new Error("daemon unavailable"))
			.mockResolvedValue(session);
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		})();

		await expect(
			hooks.tool.notebooks_run_cell.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, toolContext()),
		).rejects.toThrow(/daemon unavailable/);
		await expect(
			hooks.tool.notebooks_run_cell.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, toolContext()),
		).resolves.toMatchObject({ metadata: { notebook_id: NOTEBOOK_ID } });
		expect(openNotebook).toHaveBeenCalledTimes(2);
	});

	it("keeps a shared notebook peer open while another Kilo session still owns it", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			runCell: vi.fn(async () => ({
				cellId: "cell-1",
				executionId: "execution-1",
				status: "done",
				success: true,
				outputs: [],
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();
		await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "1" },
			{ ...toolContext(), sessionID: "kilo-session-1" },
		);
		await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "2" },
			{ ...toolContext(), sessionID: "kilo-session-2" },
		);

		await hooks.event?.({
			event: { type: "session.deleted", properties: { sessionID: "kilo-session-1" } },
		});
		expect(session.close).not.toHaveBeenCalled();

		await hooks.event?.({ event: { type: "file.edited" } });
		await hooks.event?.({
			event: { type: "session.deleted", properties: { sessionID: "kilo-session-2" } },
		});
		expect(session.close).toHaveBeenCalledOnce();
	});

	it("projects stderr, traceback, and unknown outputs from a run cell", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			runCell: vi.fn(async () => ({
				cellId: "cell-9",
				executionId: "execution-9",
				status: "error",
				success: false,
				outputs: [
					{ outputType: "stream", name: "stderr", text: "warn\n" },
					{ outputType: "display_data", dataJson: "{not-json" },
					{
						outputType: "error",
						ename: "ValueError",
						evalue: "bad",
						traceback: ["Traceback (most recent call last):", "ValueError: bad"],
					},
					{ outputType: "update_display_data" },
				],
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		const result = await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "raise ValueError('bad')" },
			toolContext(),
		);

		expect(result.output).toContain("[stderr] warn");
		expect(result.output).toContain("Traceback (most recent call last):");
		expect(result.output).toContain("[update_display_data output]");
	});

	it("refuses cancelled run and create calls and missing cells", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			getCell: vi.fn(async () => null),
			createCell: vi.fn(),
			runCell: vi.fn(),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();
		const aborted = new AbortController();
		aborted.abort();

		await expect(
			hooks.tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "1" },
				toolContext({ abort: aborted.signal }),
			),
		).rejects.toThrow(/cancelled/);
		await expect(
			hooks.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "1" },
				toolContext({ abort: aborted.signal }),
			),
		).rejects.toThrow(/cancelled/);
		await expect(
			hooks.tool.notebooks_read.execute(
				{ notebook_id: NOTEBOOK_ID, cell_id: "missing" },
				toolContext(),
			),
		).rejects.toThrow(/was not found/);
		expect(session.runCell).not.toHaveBeenCalled();
		expect(session.createCell).not.toHaveBeenCalled();
	});

	it("creates a markdown cell at the start without executing it", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			createCell: vi.fn(async () => "cell-md"),
			executeCell: vi.fn(),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		const result = await hooks.tool.notebooks_create_cell.execute(
			{
				notebook_id: NOTEBOOK_ID,
				source: "# Intro",
				cell_type: "markdown",
				after_cell_id: null,
			},
			toolContext(),
		);

		expect(session.createCell).toHaveBeenCalledWith("# Intro", { cellType: "markdown", index: 0 });
		expect(session.executeCell).not.toHaveBeenCalled();
		expect(JSON.parse(result.output)).toEqual({
			notebook_id: NOTEBOOK_ID,
			cell_id: "cell-md",
			cell_type: "markdown",
		});
	});

	it("executes every code cell and stops on the first failure", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			listCells: vi.fn(async () => [
				{ id: "md", cellType: "markdown", position: "a0", source: "# t", metadataJson: "{}" },
				{ id: "cell-1", cellType: "code", position: "a1", source: "1", metadataJson: "{}" },
				{ id: "cell-2", cellType: "code", position: "a2", source: "2", metadataJson: "{}" },
			]),
			executeCell: vi
				.fn()
				.mockResolvedValueOnce({
					cellId: "cell-1",
					executionId: "e1",
					status: "error",
					success: false,
					outputs: [{ outputType: "error", ename: "Error", evalue: "boom" }],
				})
				.mockResolvedValueOnce({
					cellId: "cell-2",
					executionId: "e2",
					status: "done",
					success: true,
					outputs: [],
				}),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		const result = await hooks.tool.notebooks_execute.execute(
			{ notebook_id: NOTEBOOK_ID },
			toolContext(),
		);

		expect(session.executeCell).toHaveBeenCalledOnce();
		expect(result.metadata).toMatchObject({ status: "error", cell_ids: ["cell-1"] });
	});

	it("removes packages, syncs, and reports dependency status", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			removeDependencies: vi.fn(async () => undefined),
			syncEnvironment: vi.fn(async () => undefined),
			getDependencyStatus: vi.fn(async () => ({ fingerprint: "environment-0" })),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		await expect(
			hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add" },
				toolContext(),
			),
		).rejects.toThrow(/packages is required/);
		await hooks.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["pandas"] },
			toolContext(),
		);
		await hooks.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "sync" },
			toolContext(),
		);
		const status = await hooks.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "status" },
			toolContext(),
		);

		expect(session.removeDependencies).toHaveBeenCalledWith(["pandas"], undefined);
		expect(session.syncEnvironment).toHaveBeenCalledTimes(2);
		expect(JSON.parse(status.output).action).toBe("status");
	});

	it("interrupts the kernel and saves to the notebook's current path", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			interruptKernel: vi.fn(async () => undefined),
			getRuntimeStatus: vi.fn(async () => ({ status: "idle" })),
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		await hooks.tool.notebooks_kernel.execute(
			{ notebook_id: NOTEBOOK_ID, action: "interrupt" },
			toolContext(),
		);
		const saved = await hooks.tool.notebooks_save.execute(
			{ notebook_id: NOTEBOOK_ID },
			toolContext(),
		);
		await expect(
			hooks.tool.notebooks_save.execute(
				{ notebook_id: NOTEBOOK_ID, path: "notes.txt" },
				toolContext(),
			),
		).rejects.toThrow(/must end in \.ipynb/);

		expect(session.interruptKernel).toHaveBeenCalledOnce();
		expect(session.saveNotebook).toHaveBeenCalledWith();
		expect(saved.output).toBe("Saved to the notebook's current path.");
	});
});
