import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createNteractKiloPlugin } from "./index";

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
			getCell: vi.fn(async (cellId: string) => ({ id: cellId })),
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
			getCell: vi.fn(async (cellId: string) => ({ id: cellId })),
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
				{ action: "update", cell_id: "cell-2" },
				{ action: "move", cell_id: "cell-2", position: "a2" },
				{ action: "delete", cell_id: "cell-3" },
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

	it("rejects edit operations with misspelled keys instead of dropping them", async () => {
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn() }),
		})();

		expect(
			z.safeParse(hooks.tool.notebooks_edit_cells.args.operations!, [
				{ action: "update", cell_id: "cell-1", "source/remove the kernel line": "x = 1" },
			]).success,
		).toBe(false);
	});

	it("refuses updates that change nothing before applying any operation", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async () => true),
			deleteCell: vi.fn(async () => true),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		await expect(
			hooks.tool.notebooks_edit_cells.execute(
				{
					notebook_id: NOTEBOOK_ID,
					operations: [
						{ action: "delete", cell_id: "cell-1" },
						{ action: "update", cell_id: "cell-2" },
					],
				},
				toolContext(),
			),
		).rejects.toThrow(/Operation 2 \(update cell-2\) must set source or cell_type/);
		expect(session.deleteCell).not.toHaveBeenCalled();
	});

	it("fails the batch when a cell is missing and reports what was already applied", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async (cellId: string) => cellId !== "cell-missing"),
			deleteCell: vi.fn(async () => true),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		await expect(
			hooks.tool.notebooks_edit_cells.execute(
				{
					notebook_id: NOTEBOOK_ID,
					operations: [
						{ action: "update", cell_id: "cell-1", source: "a = 1" },
						{ action: "update", cell_id: "cell-missing", source: "b = 2" },
						{ action: "delete", cell_id: "cell-3" },
					],
				},
				toolContext(),
			),
		).rejects.toThrow(
			'Operation 2 (update cell-missing) failed: cell not found. Applied before the failure: [{"action":"update","cell_id":"cell-1"}]',
		);
		expect(session.deleteCell).not.toHaveBeenCalled();
	});

	it("fails a move whose cell or anchor is missing instead of misplacing the cell", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			getCell: vi.fn(async (cellId: string) => (cellId === "cell-gone" ? null : { id: cellId })),
			moveCell: vi.fn(async (cellId: string) => {
				if (cellId === "cell-gone") throw new Error("cell not found: cell-gone");
				return "a2";
			}),
			createCell: vi.fn(async () => "cell-new"),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();
		const moveTo = (cellId: string, afterCellId: string) =>
			hooks.tool.notebooks_edit_cells.execute(
				{
					notebook_id: NOTEBOOK_ID,
					operations: [{ action: "move", cell_id: cellId, after_cell_id: afterCellId }],
				},
				toolContext(),
			);

		await expect(moveTo("cell-2", "cell-gone")).rejects.toThrow(
			"Operation 1 (move cell-2) failed: after_cell_id cell-gone was not found",
		);
		await expect(moveTo("cell-gone", "cell-1")).rejects.toThrow(
			"Operation 1 (move cell-gone) failed: cell not found: cell-gone",
		);
		expect(session.moveCell).toHaveBeenCalledOnce();

		await expect(
			hooks.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "x = 1", after_cell_id: "cell-gone" },
				toolContext(),
			),
		).rejects.toThrow("after_cell_id cell-gone was not found");
		expect(session.createCell).not.toHaveBeenCalled();
	});

	it("reports a lost connection and reopens the notebook peer on the next call", async () => {
		let emitStatus: (status: unknown) => void = () => undefined;
		const subscription = { unsubscribe: vi.fn() };
		const createSession = () => ({
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async () => true),
			sessionStatus$: {
				subscribe: vi.fn((next: (status: unknown) => void) => {
					emitStatus = next;
					return subscription;
				}),
			},
			close: vi.fn(async () => undefined),
		});
		const first = createSession();
		const second = createSession();
		const openNotebook = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		})();
		const edit = {
			notebook_id: NOTEBOOK_ID,
			operations: [{ action: "update" as const, cell_id: "cell-1", source: "a = 1" }],
		};

		emitStatus({ connection: "Connected", notebook_doc: "Interactive" });
		await hooks.tool.notebooks_edit_cells.execute(edit, toolContext());
		first.setCell.mockImplementationOnce(async () => {
			emitStatus({ connection: "Disconnected", notebook_doc: "Interactive" });
			return true;
		});

		await expect(hooks.tool.notebooks_edit_cells.execute(edit, toolContext())).rejects.toThrow(
			/notebook connection was lost/,
		);
		expect(first.close).toHaveBeenCalledOnce();
		expect(subscription.unsubscribe).toHaveBeenCalledOnce();

		await hooks.tool.notebooks_edit_cells.execute(edit, toolContext());
		expect(openNotebook).toHaveBeenCalledTimes(2);
		expect(second.setCell).toHaveBeenCalledOnce();
	});

	it("executes selected existing cells in order and combines their results", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			listCells: vi.fn(async () => []),
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
			declaration: { recorded: true, packages: ["polars>=1"], package_manager: "uv" },
			environment_sync: { status: "applied", typed: false },
			kernel: null,
			status: { uv: { dependencies: ["polars>=1"] }, fingerprint: "environment-2" },
		});
	});

	it("controls the notebook kernel and reports its resulting status", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			restartKernel: vi.fn(async () => undefined),
			getRuntimeStatus: vi.fn(async () => ({
				status: "idle",
				lifecycle: "Running",
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
				lifecycle: "Running",
				startingPhase: "ready",
				name: "python",
				language: "python",
				envSource: "uv",
				runtimeAgentId: "runtime-1",
			},
		});
	});

	describe("notebooks_diagnose", () => {
		const CONDA_ERROR =
			"Failed to create conda env 'notebook-test' from environment.yml: Failed to fetch package metadata: HTTP status client error (403 Forbidden)";

		function diagnoseHooks(session: Record<string, unknown>) {
			return createNteractKiloPlugin({
				loadRuntimedNode: () => ({
					openNotebook: vi.fn(async () => ({
						notebookId: NOTEBOOK_ID,
						close: vi.fn(),
						...session,
					})),
				}),
			})();
		}

		it("reports the kernel startup error the user sees in the notebook", async () => {
			const hooks = await diagnoseHooks({
				getRuntimeStatus: vi.fn(async () => ({
					status: "error",
					lifecycle: "Error",
					startingPhase: "",
					name: "",
					language: "",
					envSource: "conda:env_yml",
					runtimeAgentId: "",
					errorReason: "conda_env_build_failed",
					errorDetails: `\u001b[31m${CONDA_ERROR}\u001b[0m\n`,
				})),
				getDependencyStatus: vi.fn(async () => ({
					conda: { dependencies: ["pandas"], channels: ["main"] },
					trust: { status: "trusted", needsApproval: false },
				})),
			});

			const result = await hooks.tool.notebooks_diagnose.execute(
				{ notebook_id: NOTEBOOK_ID },
				toolContext(),
			);

			expect(result.title).toBe("Notebook error diagnosed");
			expect(result.metadata).toEqual({ notebook_id: NOTEBOOK_ID, has_error: true });
			expect(JSON.parse(result.output)).toEqual({
				notebook_id: NOTEBOOK_ID,
				summary: `Kernel failed to start: conda_env_build_failed: ${CONDA_ERROR}`,
				kernel_error: { reason: "conda_env_build_failed", details: CONDA_ERROR },
				kernel: {
					lifecycle: "Error",
					status: "error",
					starting_phase: "",
					unconfirmed: { env_source: "conda:env_yml" },
					name: "",
					language: "",
				},
				dependencies: {
					conda: { dependencies: ["pandas"], channels: ["main"] },
					trust: { status: "trusted", needsApproval: false },
				},
				typosquat_warnings: [],
			});
		});

		it("reports a healthy kernel without an error", async () => {
			const hooks = await diagnoseHooks({
				getRuntimeStatus: vi.fn(async () => ({
					status: "idle",
					lifecycle: "Running",
					activity: "Idle",
					startingPhase: "",
					name: "python3",
					language: "python",
					envSource: "uv:inline",
					runtimeAgentId: "runtime-1",
				})),
				getDependencyStatus: vi.fn(async () => ({ trust: { needsApproval: false } })),
			});

			const result = await hooks.tool.notebooks_diagnose.execute(
				{ notebook_id: NOTEBOOK_ID },
				toolContext(),
			);

			expect(result.metadata).toEqual({ notebook_id: NOTEBOOK_ID, has_error: false });
			expect(JSON.parse(result.output)).toMatchObject({
				summary: "Kernel is running (Idle).",
				kernel_error: null,
			});
		});

		it("points at trust approval and still reports kernel state when dependency status fails", async () => {
			const hooks = await diagnoseHooks({
				getRuntimeStatus: vi.fn(async () => ({
					status: "not_started",
					lifecycle: "AwaitingTrust",
					startingPhase: "",
					name: "",
					language: "",
					envSource: "",
					runtimeAgentId: "",
				})),
				getDependencyStatus: vi.fn(async () => {
					throw new Error("dependency metadata unavailable");
				}),
			});

			const output = JSON.parse(
				(await hooks.tool.notebooks_diagnose.execute({ notebook_id: NOTEBOOK_ID }, toolContext()))
					.output,
			);

			expect(output.summary).toMatch(/approve the notebook dependencies/);
			expect(output.summary).toMatch(/approve_trust/);
			expect(output.dependencies_error).toBe("dependency metadata unavailable");
			expect(output).not.toHaveProperty("dependencies");
		});

		it("adds the kernel error to notebooks_dependencies results", async () => {
			const hooks = await diagnoseHooks({
				getRuntimeStatus: vi.fn(async () => ({
					lifecycle: "Error",
					errorReason: "conda_env_build_failed",
					errorDetails: CONDA_ERROR,
				})),
				getDependencyStatus: vi.fn(async () => ({ fingerprint: "environment-1" })),
			});

			const result = await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "status" },
				toolContext(),
			);

			expect(JSON.parse(result.output)).toEqual({
				notebook_id: NOTEBOOK_ID,
				action: "status",
				status: { fingerprint: "environment-1" },
				kernel_error: { reason: "conda_env_build_failed", details: CONDA_ERROR },
			});
		});
	});

	describe("dependency approval", () => {
		const TRUST_REJECTION = "Trust changed before the action could run. Review the notebook again.";
		const TRUSTED = { status: "trusted", needsApproval: false };
		// A notebook opened from disk that declares one package the machine has not approved.
		const UNTRUSTED_STATUS = {
			uv: { dependencies: ["evil-pkg", "numpy"] },
			fingerprint: "deps-1",
			trust: { status: "untrusted", needsApproval: true, approvedUvDependencies: ["numpy"] },
		};

		type AskRequest = {
			permission: string;
			patterns: string[];
			always: string[];
			metadata: Record<string, unknown>;
		};

		function approvalSession(
			dependencyStatus: Record<string, unknown> = { fingerprint: "deps-1", trust: TRUSTED },
			fingerprintAfterPrompt: string | null = "deps-1",
		) {
			return {
				notebookId: NOTEBOOK_ID,
				listCells: vi.fn(async () => []),
				addDependencies: vi.fn(async () => undefined),
				removeDependencies: vi.fn(async () => 1),
				syncEnvironment: vi.fn(async () => undefined),
				approveTrust: vi.fn(async () => undefined),
				dependencyFingerprint: vi.fn(async () => fingerprintAfterPrompt),
				runCell: vi.fn(async () => ({
					cellId: "cell-1",
					executionId: "execution-1",
					executionCount: 1,
					status: "done",
					success: true,
					outputs: [],
				})),
				executeCell: vi.fn(async () => {
					throw new Error(TRUST_REJECTION);
				}),
				getDependencyStatus: vi.fn(async () => dependencyStatus),
				getRuntimeStatus: vi.fn(async () => ({
					status: "awaiting_trust",
					lifecycle: "AwaitingTrust",
					startingPhase: "",
					name: "",
					language: "",
					envSource: "",
					runtimeAgentId: "",
				})),
				close: vi.fn(async () => undefined),
			};
		}

		async function hooksFor(session: ReturnType<typeof approvalSession>) {
			return createNteractKiloPlugin({
				loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
			})();
		}

		function approving() {
			return vi.fn(async (_request: AskRequest) => undefined);
		}

		function contextWithAsk(ask: ReturnType<typeof vi.fn>) {
			return { ...toolContext(), ask: ask as never };
		}

		it("makes dependency and execution approval prompt even when the agent allows every permission", async () => {
			const hooks = await hooksFor(approvalSession());
			const unconfigured: { permission?: unknown } = {};
			const allowAll: { permission?: unknown } = { permission: { "*": "allow" } };
			const userChoice: { permission?: unknown } = {
				permission: { notebooks_trust: "allow", notebooks_execute: "deny" },
			};
			const allowExecute: { permission?: unknown } = {
				permission: { notebooks_execute: "allow" },
			};
			const rememberedApproval: { permission?: unknown } = {
				permission: { notebooks_execute: { [`ses_x:${NOTEBOOK_ID}`]: "allow" } },
			};
			const userPatterns = { "*": "allow", a: "deny" };
			const userWildcard: { permission?: unknown } = {
				permission: { notebooks_execute: userPatterns },
			};

			for (const config of [
				unconfigured,
				allowAll,
				userChoice,
				allowExecute,
				rememberedApproval,
				userWildcard,
			]) {
				await hooks.config?.(config);
			}

			expect(unconfigured.permission).toEqual({
				notebooks_trust: "ask",
				notebooks_execute: "ask",
			});
			// Kilo evaluates the last matching rule, so the later entries override the catch-all.
			expect(Object.entries(allowAll.permission as object)).toEqual([
				["*", "allow"],
				["notebooks_trust", "ask"],
				["notebooks_execute", "ask"],
			]);
			expect(userChoice.permission).toEqual({
				notebooks_trust: "allow",
				notebooks_execute: "deny",
			});
			expect(allowExecute.permission).toEqual({
				notebooks_execute: "allow",
				notebooks_trust: "ask",
			});
			// Remembered "Always allow" rules must not drop the gate for everything else;
			// the catch-all comes first so the later, specific allows still win.
			const { notebooks_execute: remembered } = rememberedApproval.permission as {
				notebooks_execute: object;
			};
			expect(Object.entries(remembered)).toEqual([
				["*", "ask"],
				[`ses_x:${NOTEBOOK_ID}`, "allow"],
			]);
			expect((userWildcard.permission as Record<string, unknown>).notebooks_execute).toEqual({
				"*": "allow",
				a: "deny",
			});
			expect(Object.keys(userPatterns)).toEqual(["*", "a"]);
		});

		it("adds default-approved packages to a trusted notebook without asking", async () => {
			const session = approvalSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["pandas>=2", "conda-forge::numpy"] },
				contextWithAsk(ask),
			);

			expect(ask).not.toHaveBeenCalled();
			expect(session.addDependencies).toHaveBeenCalledWith(
				["pandas>=2", "conda-forge::numpy"],
				undefined,
			);
		});

		it("asks before adding a new package and allows remembering it per package", async () => {
			const session = approvalSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{
					notebook_id: NOTEBOOK_ID,
					action: "add",
					packages: ["requests>=2"],
					package_manager: "uv",
				},
				contextWithAsk(ask),
			);

			expect(ask).toHaveBeenCalledWith({
				permission: "notebooks_trust",
				patterns: ["requests"],
				always: ["requests"],
				metadata: {
					toolName: "Notebook packages",
					title: "Allow the agent to install requests in this notebook?",
					description:
						"Approved packages can be installed into any notebook on this computer without asking again. Only approve packages you recognize.",
					notebook_id: NOTEBOOK_ID,
					action: "add",
					approves: ["requests"],
					typosquat_warnings: [],
				},
			});
			expect(session.addDependencies).toHaveBeenCalledWith(["requests>=2"], {
				packageManager: "uv",
			});
		});

		it("lists the notebook's unapproved dependencies that an add would also approve", async () => {
			const session = approvalSession(UNTRUSTED_STATUS);
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["requests"] },
				contextWithAsk(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({
				patterns: ["uv: evil-pkg", "requests"],
				always: ["requests"],
			});
			expect(session.addDependencies).toHaveBeenCalledOnce();
		});

		it("titles the prompt with what the change will approve", async () => {
			const titleFor = async (
				status: Record<string, unknown>,
				args: { action: "add" | "remove" | "approve_trust"; packages?: string[] },
			) => {
				const ask = approving();
				await (
					await hooksFor(approvalSession(status))
				).tool.notebooks_dependencies.execute(
					{ notebook_id: NOTEBOOK_ID, ...args },
					contextWithAsk(ask),
				);
				return ask.mock.calls[0]?.[0].metadata["title"];
			};
			const trusted = { fingerprint: "deps-1", trust: TRUSTED };
			const twoUnapproved = {
				...UNTRUSTED_STATUS,
				uv: { dependencies: ["evil-pkg", "other-pkg", "numpy"] },
			};

			expect(await titleFor(trusted, { action: "add", packages: ["humanize", "emoji>=2"] })).toBe(
				"Allow the agent to install humanize and emoji in this notebook?",
			);
			expect(
				await titleFor(trusted, { action: "add", packages: ["humanize", "emoji", "cowsay"] }),
			).toBe("Allow the agent to install 3 packages in this notebook?");
			expect(await titleFor(UNTRUSTED_STATUS, { action: "add", packages: ["tqdm"] })).toBe(
				"Installing tqdm will also approve packages this notebook already lists",
			);
			expect(await titleFor(twoUnapproved, { action: "remove", packages: ["evil-pkg"] })).toBe(
				"Removing evil-pkg will approve the packages that remain",
			);
			expect(await titleFor(UNTRUSTED_STATUS, { action: "approve_trust" })).toBe(
				"Approve the packages this notebook needs?",
			);
		});

		it("marks typosquats in the prompt and never offers to remember them", async () => {
			const session = approvalSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["numppy>=1"] },
				contextWithAsk(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({
				patterns: ["numppy (similar to numpy)"],
				always: [],
				metadata: {
					typosquat_warnings: [{ package: "numppy", similar_to: "numpy", distance: 1 }],
				},
			});
		});

		it("installs nothing when the user rejects an add or run_cell dependency", async () => {
			const session = approvalSession();
			const hooks = await hooksFor(session);
			const ask = vi.fn(async () => {
				throw new Error("The user rejected permission to use this specific tool call.");
			});

			await expect(
				hooks.tool.notebooks_dependencies.execute(
					{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["reqeusts"] },
					contextWithAsk(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_run_cell.execute(
					{ notebook_id: NOTEBOOK_ID, code: "import requests", dependencies: ["requests"] },
					contextWithAsk(ask),
				),
			).rejects.toThrow(/rejected/);

			expect(session.addDependencies).not.toHaveBeenCalled();
			expect(session.syncEnvironment).not.toHaveBeenCalled();
			expect(session.runCell).not.toHaveBeenCalled();
		});

		it("aborts when the dependencies change while the prompt is open", async () => {
			const session = approvalSession(UNTRUSTED_STATUS, "deps-2");

			await expect(
				(await hooksFor(session)).tool.notebooks_dependencies.execute(
					{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
					contextWithAsk(approving()),
				),
			).rejects.toThrow(/changed while approval was pending/);
			expect(session.approveTrust).not.toHaveBeenCalled();
		});

		it("asks before a removal that would approve the remaining unapproved dependencies", async () => {
			const session = approvalSession({
				...UNTRUSTED_STATUS,
				uv: { dependencies: ["evil-pkg", "other-pkg", "numpy"] },
			});
			const hooks = await hooksFor(session);
			const ask = approving();

			await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg"] },
				contextWithAsk(ask),
			);
			await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg", "other-pkg"] },
				contextWithAsk(ask),
			);

			expect(ask).toHaveBeenCalledOnce();
			expect(ask.mock.calls[0]?.[0]).toMatchObject({ patterns: ["uv: other-pkg"], always: [] });
			expect(session.removeDependencies).toHaveBeenCalledTimes(2);
		});

		it("approves trust only after listing every unapproved dependency", async () => {
			const session = approvalSession({
				uv: { dependencies: ["numppy", "numpy"] },
				pixi: { dependencies: [], pypiDependencies: ["polars"], channels: [] },
				fingerprint: "deps-1",
				trust: {
					status: "untrusted",
					needsApproval: true,
					approvedUvDependencies: ["numpy"],
					approvedPixiPypiDependencies: [],
				},
			});
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				contextWithAsk(ask),
			);

			expect(ask).toHaveBeenCalledWith({
				permission: "notebooks_trust",
				patterns: ["uv: numppy (similar to numpy)", "pixi-pypi: polars"],
				always: [],
				metadata: {
					toolName: "Notebook packages",
					title: "Check package names: some look like misspellings of popular packages",
					description: expect.stringContaining("any notebook on this computer"),
					notebook_id: NOTEBOOK_ID,
					action: "approve",
					approves: ["uv: numppy", "pixi-pypi: polars"],
					typosquat_warnings: [{ package: "numppy", similar_to: "numpy", distance: 1 }],
				},
			});
			expect(session.approveTrust).toHaveBeenCalledWith(undefined);
		});

		it("never offers to remember a package the notebook already declares unapproved", async () => {
			const session = approvalSession(UNTRUSTED_STATUS);
			const ask = approving();
			const hooks = await hooksFor(session);

			await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["evil-pkg"] },
				contextWithAsk(ask),
			);
			await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["evil-pkg>=1"] },
				contextWithAsk(ask),
			);

			// The exact spec is listed once, as the notebook's own dependency.
			expect(ask.mock.calls[0]?.[0]).toMatchObject({ patterns: ["uv: evil-pkg"], always: [] });
			// A different spec for the same package is shown but still not rememberable.
			expect(ask.mock.calls[1]?.[0]).toMatchObject({
				patterns: ["uv: evil-pkg", "evil-pkg"],
				always: [],
			});
		});

		it("asks about unapproved channels when a removal clears every unapproved package", async () => {
			const session = approvalSession({
				conda: { dependencies: ["evil-pkg", "numpy"], channels: ["my-org"] },
				fingerprint: "deps-1",
				trust: { status: "untrusted", needsApproval: true, approvedCondaDependencies: ["numpy"] },
			});
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg"] },
				contextWithAsk(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({
				patterns: ["conda channel: my-org"],
				always: [],
			});
			expect(session.removeDependencies).toHaveBeenCalledOnce();
		});

		it("asks about unapproved conda channels when every package is approved", async () => {
			const session = approvalSession({
				conda: { dependencies: ["numpy"], channels: ["conda-forge", "my-org"] },
				fingerprint: "deps-1",
				trust: { status: "untrusted", needsApproval: true, approvedCondaDependencies: ["numpy"] },
			});
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				contextWithAsk(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({ patterns: ["conda channel: my-org"] });
			expect(session.approveTrust).toHaveBeenCalledOnce();
		});

		it("does not ask or approve when nothing needs approval", async () => {
			const session = approvalSession();
			const ask = approving();

			const result = await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				contextWithAsk(ask),
			);

			expect(ask).not.toHaveBeenCalled();
			expect(session.approveTrust).not.toHaveBeenCalled();
			expect(JSON.parse(result.output)).not.toHaveProperty("approval");
		});

		it("reports what needs approval in dependency status and diagnosis", async () => {
			const hooks = await hooksFor(approvalSession(UNTRUSTED_STATUS));

			const status = JSON.parse(
				(
					await hooks.tool.notebooks_dependencies.execute(
						{ notebook_id: NOTEBOOK_ID, action: "status" },
						toolContext(),
					)
				).output,
			);
			const diagnosis = JSON.parse(
				(await hooks.tool.notebooks_diagnose.execute({ notebook_id: NOTEBOOK_ID }, toolContext()))
					.output,
			);

			expect(status.approval).toEqual({ needs_approval: true, unapproved: ["uv: evil-pkg"] });
			expect(diagnosis.approval).toEqual({ needs_approval: true, unapproved: ["uv: evil-pkg"] });
			expect(diagnosis.summary).toMatch(/waiting for the user to approve.*uv: evil-pkg/);
			expect(diagnosis.summary).toMatch(/Review/);
		});

		it("explains a trust rejection instead of surfacing the daemon's message", async () => {
			const hooks = await hooksFor(approvalSession(UNTRUSTED_STATUS));

			await expect(
				hooks.tool.notebooks_execute.execute(
					{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1"] },
					toolContext(),
				),
			).rejects.toThrow(/need approval before.*uv: evil-pkg.*approve_trust/s);
		});
	});

	describe("execution approval", () => {
		type AskRequest = {
			permission: string;
			patterns: string[];
			always: string[];
			metadata: Record<string, unknown>;
		};

		const RUN_DESCRIPTION =
			"The code runs on your computer with your permissions. Only allow code you expect.";
		const SESSION_SCOPE = `kilo-session-1:${NOTEBOOK_ID}`;

		function cellResult(cellId: string) {
			return {
				cellId,
				executionId: `execution-${cellId}`,
				executionCount: 1,
				status: "done",
				success: true,
				outputs: [],
			};
		}

		function executionSession() {
			return {
				notebookId: NOTEBOOK_ID,
				getCell: vi.fn(async (cellId: string) => ({ id: cellId })),
				listCells: vi.fn(async () => [
					{ id: "md", cellType: "markdown", position: "a0", source: "# t", metadataJson: "{}" },
					{ id: "cell-1", cellType: "code", position: "a1", source: "1", metadataJson: "{}" },
				]),
				createCell: vi.fn(async () => "cell-new"),
				runCell: vi.fn(async () => cellResult("cell-run")),
				executeCell: vi.fn(async (cellId: string) => cellResult(cellId)),
				addDependencies: vi.fn(async () => undefined),
				syncEnvironment: vi.fn(async () => undefined),
				getDependencyStatus: vi.fn(async () => ({
					fingerprint: "deps-1",
					trust: { status: "trusted", needsApproval: false },
				})),
				dependencyFingerprint: vi.fn(async () => "deps-1"),
				interruptKernel: vi.fn(async () => undefined),
				restartKernel: vi.fn(async () => undefined),
				getRuntimeStatus: vi.fn(async () => ({ status: "idle" })),
				close: vi.fn(async () => undefined),
			};
		}

		async function hooksFor(session: ReturnType<typeof executionSession>) {
			return createNteractKiloPlugin({
				loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
			})();
		}

		function approving() {
			return vi.fn(async (_request: AskRequest) => undefined);
		}

		function rejecting() {
			return vi.fn(async (_request: AskRequest) => {
				throw new Error("The user rejected permission to use this specific tool call.");
			});
		}

		function contextWithAsk(ask: ReturnType<typeof vi.fn>) {
			return { ...toolContext(), ask: ask as never };
		}

		it("asks once, per notebook, before run_cell executes code", async () => {
			const session = executionSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "print('hi')" },
				contextWithAsk(ask),
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith({
				permission: "notebooks_execute",
				patterns: [SESSION_SCOPE],
				always: [SESSION_SCOPE],
				metadata: {
					toolName: "Run notebook code",
					title: "Run code in this notebook?",
					description: RUN_DESCRIPTION,
					notebook_id: NOTEBOOK_ID,
					action: "run",
					code: "print('hi')",
				},
			});
			expect(session.runCell).toHaveBeenCalledOnce();
		});

		it("asks to execute before asking about run_cell dependencies", async () => {
			const session = executionSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "import requests", dependencies: ["requests"] },
				contextWithAsk(ask),
			);

			expect(ask.mock.calls.map(([request]) => request.permission)).toEqual([
				"notebooks_execute",
				"notebooks_trust",
			]);
		});

		it("changes nothing when the user rejects running code", async () => {
			const session = executionSession();
			const hooks = await hooksFor(session);
			const ask = rejecting();

			await expect(
				hooks.tool.notebooks_run_cell.execute(
					{ notebook_id: NOTEBOOK_ID, code: "1", dependencies: ["requests"] },
					contextWithAsk(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_create_cell.execute(
					{ notebook_id: NOTEBOOK_ID, source: "1", and_run: true },
					contextWithAsk(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_execute.execute(
					{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1"] },
					contextWithAsk(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_kernel.execute(
					{ notebook_id: NOTEBOOK_ID, action: "restart" },
					contextWithAsk(ask),
				),
			).rejects.toThrow(/rejected/);

			expect(ask).toHaveBeenCalledTimes(4);
			expect(ask.mock.calls.every(([request]) => request.permission === "notebooks_execute")).toBe(
				true,
			);
			expect(session.addDependencies).not.toHaveBeenCalled();
			expect(session.runCell).not.toHaveBeenCalled();
			expect(session.createCell).not.toHaveBeenCalled();
			expect(session.executeCell).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
		});

		it("asks before creating a cell that will run", async () => {
			const session = executionSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "x = 1", and_run: true },
				contextWithAsk(ask),
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					permission: "notebooks_execute",
					metadata: expect.objectContaining({
						title: "Run code in this notebook?",
						action: "run",
						code: "x = 1",
					}),
				}),
			);
			expect(session.executeCell).toHaveBeenCalledWith("cell-new", { timeoutMs: 120_000 });
		});

		it("does not ask to create a cell that will not run", async () => {
			const session = executionSession();
			const hooks = await hooksFor(session);
			const ask = approving();

			await hooks.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "x = 1" },
				contextWithAsk(ask),
			);
			await hooks.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "# t", cell_type: "markdown", and_run: true },
				contextWithAsk(ask),
			);

			expect(ask).not.toHaveBeenCalled();
			expect(session.createCell).toHaveBeenCalledTimes(2);
			expect(session.executeCell).not.toHaveBeenCalled();
		});

		it("asks once for a batch of cells, numbered by their place in the notebook", async () => {
			const session = executionSession();
			session.listCells.mockResolvedValue([
				{ id: "md", cellType: "markdown", position: "a0", source: "# t", metadataJson: "{}" },
				{ id: "cell-1", cellType: "code", position: "a1", source: "1", metadataJson: "{}" },
				{ id: "cell-2", cellType: "code", position: "a2", source: "2", metadataJson: "{}" },
				{ id: "md-2", cellType: "markdown", position: "a3", source: "#", metadataJson: "{}" },
				{ id: "cell-3", cellType: "code", position: "a4", source: "3", metadataJson: "{}" },
			]);
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_execute.execute(
				{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-3", "cell-1", "cell-2"] },
				contextWithAsk(ask),
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith({
				permission: "notebooks_execute",
				patterns: [SESSION_SCOPE],
				always: [SESSION_SCOPE],
				metadata: {
					toolName: "Run notebook code",
					title: "Run 3 notebook cells?",
					description: RUN_DESCRIPTION,
					notebook_id: NOTEBOOK_ID,
					action: "execute",
					cell_ids: ["cell-3", "cell-1", "cell-2"],
					cell_numbers: [5, 2, 3],
					all_cells: false,
				},
			});
			expect(session.executeCell).toHaveBeenCalledTimes(3);
		});

		it("titles an all-cells run and skips the prompt when there is nothing to run", async () => {
			const session = executionSession();
			const hooks = await hooksFor(session);
			const ask = approving();

			await hooks.tool.notebooks_execute.execute({ notebook_id: NOTEBOOK_ID }, contextWithAsk(ask));
			expect(ask.mock.calls[0]?.[0].metadata).toMatchObject({
				title: "Run all code cells?",
				cell_ids: ["cell-1"],
				cell_numbers: [2],
				all_cells: true,
			});

			session.listCells.mockResolvedValueOnce([]);
			await hooks.tool.notebooks_execute.execute({ notebook_id: NOTEBOOK_ID }, contextWithAsk(ask));
			expect(ask).toHaveBeenCalledOnce();
		});

		it("asks before restarting the kernel but not to interrupt or inspect it", async () => {
			const session = executionSession();
			const hooks = await hooksFor(session);
			const ask = approving();

			await hooks.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "status" },
				contextWithAsk(ask),
			);
			await hooks.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "interrupt" },
				contextWithAsk(ask),
			);
			expect(ask).not.toHaveBeenCalled();

			await hooks.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "restart" },
				contextWithAsk(ask),
			);
			expect(ask).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					permission: "notebooks_execute",
					patterns: [SESSION_SCOPE],
					always: [SESSION_SCOPE],
					metadata: expect.objectContaining({
						title: "Restart the notebook kernel?",
						action: "restart",
					}),
				}),
			);
			expect(session.restartKernel).toHaveBeenCalledOnce();
		});

		const OTHER_NOTEBOOK_ID = "0b7f3a52-8c1e-4d6a-9f2b-3e4d5c6b7a81";
		type Hooks = Awaited<ReturnType<typeof hooksFor>>;
		type Context = ReturnType<typeof contextWithAsk>;
		const executingCalls: [
			string,
			(hooks: Hooks, notebookId: string, context: Context) => unknown,
		][] = [
			[
				"run_cell",
				(hooks, notebookId, context) =>
					hooks.tool.notebooks_run_cell.execute({ notebook_id: notebookId, code: "1" }, context),
			],
			[
				"create_cell with and_run",
				(hooks, notebookId, context) =>
					hooks.tool.notebooks_create_cell.execute(
						{ notebook_id: notebookId, source: "1", and_run: true },
						context,
					),
			],
			[
				"execute",
				(hooks, notebookId, context) =>
					hooks.tool.notebooks_execute.execute({ notebook_id: notebookId }, context),
			],
			[
				"kernel restart",
				(hooks, notebookId, context) =>
					hooks.tool.notebooks_kernel.execute(
						{ notebook_id: notebookId, action: "restart" },
						context,
					),
			],
		];

		it.each(executingCalls)(
			"scopes %s approval to one notebook in one Kilo session",
			async (_name, run) => {
				const hooks = await hooksFor(executionSession());
				const ask = approving();
				const inSession = (sessionID: string) => ({ ...contextWithAsk(ask), sessionID });

				await run(hooks, NOTEBOOK_ID, inSession("kilo-session-1"));
				await run(hooks, NOTEBOOK_ID, inSession("kilo-session-2"));
				await run(hooks, OTHER_NOTEBOOK_ID, inSession("kilo-session-1"));

				expect(ask.mock.calls.map(([request]) => [request.patterns, request.always])).toEqual([
					[[`kilo-session-1:${NOTEBOOK_ID}`], [`kilo-session-1:${NOTEBOOK_ID}`]],
					[[`kilo-session-2:${NOTEBOOK_ID}`], [`kilo-session-2:${NOTEBOOK_ID}`]],
					[[`kilo-session-1:${OTHER_NOTEBOOK_ID}`], [`kilo-session-1:${OTHER_NOTEBOOK_ID}`]],
				]);
				expect(ask.mock.calls.map(([request]) => request.metadata.notebook_id)).toEqual([
					NOTEBOOK_ID,
					NOTEBOOK_ID,
					OTHER_NOTEBOOK_ID,
				]);
			},
		);

		it("refuses cancelled calls and placeholder ids before asking", async () => {
			const session = executionSession();
			const hooks = await hooksFor(session);
			const ask = approving();
			const aborted = new AbortController();
			aborted.abort();
			const cancelled = { ...contextWithAsk(ask), abort: aborted.signal };

			await expect(
				hooks.tool.notebooks_run_cell.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, cancelled),
			).rejects.toThrow(/cancelled/);
			await expect(
				hooks.tool.notebooks_create_cell.execute(
					{ notebook_id: NOTEBOOK_ID, source: "1", and_run: true },
					cancelled,
				),
			).rejects.toThrow(/cancelled/);
			await expect(
				hooks.tool.notebooks_run_cell.execute({ notebook_id: "?", code: "1" }, contextWithAsk(ask)),
			).rejects.toThrow(/notebook_id must be a notebook UUID/);

			expect(ask).not.toHaveBeenCalled();
		});
	});

	describe("notebooks_environment", () => {
		type AskRequest = {
			permission: string;
			patterns: string[];
			always: string[];
			metadata: Record<string, unknown>;
		};
		type CondaInfo = {
			id: string;
			name: string;
			prefix: string;
			pythonPath: string;
			pythonVersion?: string;
		};
		type KernelspecInfo = { name: string; displayName: string; language: string };
		type Target =
			| { kind: "automatic" }
			| { kind: "conda"; prefix: string }
			| { kind: "kernelspec"; name: string };

		const LUMEN: CondaInfo = {
			id: "conda:/opt/miniconda3/envs/lumen",
			name: "lumen",
			prefix: "/opt/miniconda3/envs/lumen",
			pythonPath: "/opt/miniconda3/envs/lumen/bin/python",
			pythonVersion: "3.12.4",
		};
		const IR: KernelspecInfo = { name: "ir", displayName: "R", language: "R" };
		const UV_RUNNING = {
			status: "idle",
			lifecycle: "Running",
			activity: "Idle",
			startingPhase: "",
			name: "python3",
			language: "python",
			envSource: "uv:inline",
			runtimeAgentId: "runtime-1",
			environmentId: "uv:inline:8f2c",
			environmentName: "",
			pythonVersion: "3.13.1",
		};

		/**
		 * The Session SDK boundary as the daemon behaves: revision-fenced staging
		 * that leaves the kernel alone, and apply that launches the staged target.
		 */
		function selectionSession(
			options: {
				revision?: number;
				selected?: CondaInfo;
				applied?: CondaInfo;
				appliedKernelspec?: KernelspecInfo;
				applying?: boolean;
				kernelspecs?: boolean;
			} = {},
		) {
			const state: {
				revision: number;
				selected?: CondaInfo;
				applied?: CondaInfo;
				selectedKernelspec?: KernelspecInfo;
				appliedKernelspec?: KernelspecInfo;
				applying: boolean;
			} = {
				revision: options.revision ?? 3,
				...(options.selected ? { selected: options.selected } : {}),
				...(options.applied ? { applied: options.applied } : {}),
				...(options.appliedKernelspec ? { appliedKernelspec: options.appliedKernelspec } : {}),
				applying: options.applying ?? false,
			};
			const snapshot = () => structuredClone(state);
			const assertRevision = (expected: number) => {
				if (expected !== state.revision) {
					throw new Error(
						`Environment selection revision ${expected} is stale; current revision is ${state.revision}.`,
					);
				}
			};
			const session = {
				notebookId: NOTEBOOK_ID,
				runtime: { ...UV_RUNNING } as Record<string, unknown>,
				getEnvironmentSelection: vi.fn(async () => snapshot()),
				setEnvironmentSelection: vi.fn(async (target: Target, expectedRevision: number) => {
					assertRevision(expectedRevision);
					delete state.selected;
					delete state.selectedKernelspec;
					if (target.kind === "conda") {
						if (target.prefix !== LUMEN.prefix) {
							throw new Error(`No Conda environment at ${target.prefix}.`);
						}
						state.selected = LUMEN;
					}
					if (target.kind === "kernelspec") state.selectedKernelspec = IR;
					state.revision += 1;
					return snapshot();
				}),
				applyEnvironmentSelection: vi.fn(async (expectedRevision: number) => {
					assertRevision(expectedRevision);
					delete state.applied;
					delete state.appliedKernelspec;
					if (state.selected) state.applied = state.selected;
					if (state.selectedKernelspec) state.appliedKernelspec = state.selectedKernelspec;
					state.revision += 1;
					session.runtime = {
						...UV_RUNNING,
						status: "starting",
						lifecycle: "Launching",
						activity: undefined,
					};
					return snapshot();
				}),
				restartKernel: vi.fn(async () => undefined),
				getRuntimeStatus: vi.fn(async () => session.runtime),
				addDependencies: vi.fn(async () => undefined),
				close: vi.fn(async () => undefined),
				...(options.kernelspecs
					? {
							listInstalledKernelspecs: vi.fn(async () => ({
								kernelspecs: [IR, { name: "python3", displayName: "Python 3", language: "python" }],
								warnings: ["Skipped /usr/local/share/jupyter/kernels/broken: missing kernel.json"],
								truncated: false,
							})),
						}
					: {}),
			};
			return session;
		}

		async function hooksFor(session: object) {
			return createNteractKiloPlugin({
				loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
			})();
		}

		function contextWithAsk(ask: ReturnType<typeof vi.fn>) {
			return { ...toolContext(), ask: ask as never };
		}

		function approving() {
			return vi.fn(async (_request: AskRequest) => undefined);
		}

		async function run(
			hooks: Awaited<ReturnType<typeof hooksFor>>,
			args: object,
			ask = approving(),
		) {
			const result = await hooks.tool.notebooks_environment.execute(
				{ notebook_id: NOTEBOOK_ID, ...args } as never,
				contextWithAsk(ask),
			);
			return { result, output: JSON.parse(result.output) as Record<string, unknown> };
		}

		it("stages an existing Conda prefix with the revision it read and leaves the kernel alone", async () => {
			const session = selectionSession();
			const hooks = await hooksFor(session);
			const ask = approving();

			const status = await run(hooks, { action: "status" }, ask);
			const staged = await run(
				hooks,
				{
					action: "select",
					target: "conda",
					prefix: LUMEN.prefix,
					expected_revision: status.output.revision,
				},
				ask,
			);

			expect(status.output).toMatchObject({
				revision: 3,
				state: "applied",
				active: true,
				selected: { kind: "automatic" },
				applied: { kind: "automatic" },
			});
			expect(session.setEnvironmentSelection).toHaveBeenCalledExactlyOnceWith(
				{ kind: "conda", prefix: "/opt/miniconda3/envs/lumen" },
				3,
			);
			expect(session.applyEnvironmentSelection).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
			expect(ask).not.toHaveBeenCalled();
			expect(staged.output).toEqual({
				notebook_id: NOTEBOOK_ID,
				action: "select",
				revision: 4,
				state: "staged",
				active: false,
				running_identity: "confirmed",
				applying: false,
				selected: {
					kind: "conda",
					id: "conda:/opt/miniconda3/envs/lumen",
					name: "lumen",
					prefix: "/opt/miniconda3/envs/lumen",
					python_path: "/opt/miniconda3/envs/lumen/bin/python",
					python_version: "3.12.4",
				},
				applied: { kind: "automatic" },
				kernel: {
					lifecycle: "Running",
					status: "idle",
					env_source: "uv:inline",
					environment_id: "uv:inline:8f2c",
					python_version: "3.13.1",
				},
				summary: expect.stringMatching(
					/Staged Conda environment lumen.*still uses the automatic environment.*apply with expected_revision 4/s,
				),
			});
			expect(staged.result.metadata).toMatchObject({ state: "staged", active: false });
		});

		it("applies the staged selection after execution approval and never calls a launching kernel active", async () => {
			const session = selectionSession({ revision: 4, selected: LUMEN });
			const ask = approving();

			const { output } = await run(
				await hooksFor(session),
				{ action: "apply", expected_revision: 4 },
				ask,
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					permission: "notebooks_execute",
					patterns: [`kilo-session-1:${NOTEBOOK_ID}`],
					always: [`kilo-session-1:${NOTEBOOK_ID}`],
					metadata: expect.objectContaining({
						title: "Restart the notebook kernel?",
						action: "restart",
					}),
				}),
			);
			expect(session.applyEnvironmentSelection).toHaveBeenCalledExactlyOnceWith(4);
			expect(session.restartKernel).not.toHaveBeenCalled();
			expect(output).toMatchObject({
				revision: 5,
				state: "applied",
				active: false,
				applied: { kind: "conda", prefix: LUMEN.prefix, python_path: LUMEN.pythonPath },
				running_identity: "unconfirmed",
				kernel: {
					lifecycle: "Launching",
					status: "starting",
					unconfirmed: {
						env_source: "uv:inline",
						environment_id: "uv:inline:8f2c",
						python_version: "3.13.1",
					},
				},
				summary: expect.stringMatching(/kernel is Launching.*not active yet/),
			});
			expect(output.kernel).not.toHaveProperty("env_source");
			expect(output.kernel).not.toHaveProperty("environment_id");
		});

		it("reports an applied selection as active once the running kernel reports its identity", async () => {
			const session = selectionSession({ revision: 6, selected: LUMEN, applied: LUMEN });
			session.runtime = {
				...UV_RUNNING,
				envSource: "conda:prefix",
				environmentId: LUMEN.id,
				environmentName: "lumen",
				pythonVersion: "3.12.4",
			};

			const { output } = await run(await hooksFor(session), { action: "status" });

			expect(output).toMatchObject({
				state: "applied",
				active: true,
				running_identity: "confirmed",
				kernel: {
					lifecycle: "Running",
					env_source: "conda:prefix",
					environment_id: LUMEN.id,
					environment_name: "lumen",
				},
				summary: expect.stringMatching(
					/Conda environment lumen \(\/opt\/miniconda3\/envs\/lumen\) is applied and the running kernel reports environment conda:\/opt\/miniconda3\/envs\/lumen/,
				),
			});
		});

		it("does not call an applied selection active when the running kernel reports another environment", async () => {
			const session = selectionSession({ revision: 6, selected: LUMEN, applied: LUMEN });

			const { output } = await run(await hooksFor(session), { action: "status" });

			expect(output).toMatchObject({
				state: "applied",
				active: false,
				running_identity: "mismatch",
				summary: expect.stringMatching(/reports environment uv:inline:8f2c.*Do not treat/s),
			});
		});

		it("leaves the running identity unconfirmed on an SDK that does not report it", async () => {
			const session = selectionSession({ revision: 6, selected: LUMEN, applied: LUMEN });
			const {
				environmentId: _id,
				environmentName: _name,
				pythonVersion: _version,
				...legacy
			} = UV_RUNNING;
			session.runtime = legacy;

			const { output } = await run(await hooksFor(session), { action: "status" });

			expect(output).toMatchObject({
				state: "applied",
				active: false,
				running_identity: "unconfirmed",
				kernel: { lifecycle: "Running", env_source: "uv:inline" },
				summary: expect.stringMatching(/does not report which environment.*unconfirmed/s),
			});
		});

		it("reports an in-flight apply as applying, not active", async () => {
			const session = selectionSession({ selected: LUMEN, applied: LUMEN, applying: true });
			session.runtime = { ...UV_RUNNING, lifecycle: "Launching", status: "starting" };

			const { output } = await run(await hooksFor(session), { action: "status" });

			expect(output).toMatchObject({
				state: "applying",
				active: false,
				applying: true,
				summary: expect.stringMatching(/not active yet/),
			});
		});

		it("changes nothing when the user denies the restart that apply needs", async () => {
			const session = selectionSession({ revision: 4, selected: LUMEN });
			const ask = vi.fn(async (_request: AskRequest) => {
				throw new Error("The user rejected permission to use this specific tool call.");
			});

			await expect(
				run(await hooksFor(session), { action: "apply", expected_revision: 4 }, ask),
			).rejects.toThrow(/rejected/);

			expect(ask).toHaveBeenCalledOnce();
			expect(session.applyEnvironmentSelection).not.toHaveBeenCalled();
			expect(session.setEnvironmentSelection).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
		});

		it("propagates a stale revision once without retrying or overwriting the newer selection", async () => {
			const session = selectionSession({ revision: 5, selected: LUMEN });
			const hooks = await hooksFor(session);

			await expect(
				run(hooks, { action: "select", target: "automatic", expected_revision: 3 }),
			).rejects.toThrow(
				/revision 3 is stale; current revision is 5.*Nothing was retried.*notebooks_environment action status/s,
			);
			await expect(run(hooks, { action: "apply", expected_revision: 4 })).rejects.toThrow(
				/revision 4 is stale/,
			);

			expect(session.setEnvironmentSelection).toHaveBeenCalledOnce();
			expect(session.applyEnvironmentSelection).toHaveBeenCalledOnce();
			const { output } = await run(hooks, { action: "status" });
			expect(output).toMatchObject({ revision: 5, selected: { kind: "conda", name: "lumen" } });
		});

		it("returns to the automatic environment through an explicit selection", async () => {
			const session = selectionSession({ revision: 7, selected: LUMEN, applied: LUMEN });

			const { output } = await run(await hooksFor(session), {
				action: "select",
				target: "automatic",
				expected_revision: 7,
			});

			expect(session.setEnvironmentSelection).toHaveBeenCalledExactlyOnceWith(
				{ kind: "automatic" },
				7,
			);
			expect(output).toMatchObject({
				state: "staged",
				selected: { kind: "automatic" },
				applied: { kind: "conda", name: "lumen" },
			});
		});

		it("reports unsupported without prompting or changing anything when the SDK lacks selection", async () => {
			const session = {
				notebookId: NOTEBOOK_ID,
				restartKernel: vi.fn(async () => undefined),
				getRuntimeStatus: vi.fn(async () => UV_RUNNING),
				close: vi.fn(async () => undefined),
			};
			const hooks = await hooksFor(session);
			const ask = approving();

			for (const args of [
				{ action: "status" },
				{ action: "select", target: "conda", prefix: LUMEN.prefix, expected_revision: 1 },
				{ action: "apply", expected_revision: 1 },
			]) {
				const { result, output } = await run(hooks, args, ask);
				expect(output).toMatchObject({
					status: "unsupported",
					capability: "environment_selection",
					changed: false,
				});
				expect(result.metadata).toMatchObject({ status: "unsupported", changed: false });
			}
			expect(ask).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
		});

		it("reads status on a partial SDK but refuses apply there before prompting", async () => {
			const session = {
				notebookId: NOTEBOOK_ID,
				getEnvironmentSelection: vi.fn(async () => ({ revision: 2, applying: false })),
				restartKernel: vi.fn(async () => undefined),
				getRuntimeStatus: vi.fn(async () => UV_RUNNING),
				close: vi.fn(async () => undefined),
			};
			const hooks = await hooksFor(session);
			const ask = approving();

			const status = await run(hooks, { action: "status" }, ask);
			const apply = await run(hooks, { action: "apply", expected_revision: 2 }, ask);

			expect(status.output).toMatchObject({ revision: 2, state: "applied" });
			expect(apply.output).toEqual({
				notebook_id: NOTEBOOK_ID,
				action: "apply",
				status: "unsupported",
				capability: "environment_selection",
				changed: false,
				message: expect.stringMatching(/Nothing was changed.*Do not register a kernelspec/s),
			});
			expect(ask).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
		});

		it("reports kernelspecs unsupported on an SDK without the installed-kernelspec catalog", async () => {
			const session = selectionSession();
			const hooks = await hooksFor(session);

			const listed = await run(hooks, { action: "list_kernelspecs" });
			const selected = await run(hooks, {
				action: "select",
				target: "kernelspec",
				name: "ir",
				expected_revision: 3,
			});

			for (const { output } of [listed, selected]) {
				expect(output).toMatchObject({
					status: "unsupported",
					capability: "installed_kernelspecs",
					changed: false,
				});
			}
			expect(session.setEnvironmentSelection).not.toHaveBeenCalled();
		});

		it("lists installed kernelspecs and stages one by name across selection kinds", async () => {
			const session = selectionSession({ kernelspecs: true, applied: LUMEN, selected: LUMEN });
			const hooks = await hooksFor(session);

			const listed = await run(hooks, { action: "list_kernelspecs" });
			const staged = await run(hooks, {
				action: "select",
				target: "kernelspec",
				name: "ir",
				expected_revision: 3,
			});
			const applied = await run(hooks, { action: "apply", expected_revision: 4 });

			expect(listed.output).toEqual({
				notebook_id: NOTEBOOK_ID,
				action: "list_kernelspecs",
				kernelspecs: [
					{ name: "ir", display_name: "R", language: "R" },
					{ name: "python3", display_name: "Python 3", language: "python" },
				],
				warnings: ["Skipped /usr/local/share/jupyter/kernels/broken: missing kernel.json"],
				truncated: false,
			});
			expect(session.setEnvironmentSelection).toHaveBeenCalledExactlyOnceWith(
				{ kind: "kernelspec", name: "ir" },
				3,
			);
			expect(staged.output).toMatchObject({
				state: "staged",
				selected: { kind: "kernelspec", name: "ir", display_name: "R", language: "R" },
				applied: { kind: "conda", name: "lumen" },
			});
			expect(applied.output).toMatchObject({
				state: "applied",
				active: false,
				applied: { kind: "kernelspec", name: "ir" },
			});
		});

		it.each([
			["an unknown action", { action: "switch" }, /action must be one of/],
			["select without a revision", { action: "select", target: "automatic" }, /expected_revision/],
			["a negative revision", { action: "apply", expected_revision: -1 }, /expected_revision/],
			["a fractional revision", { action: "apply", expected_revision: 1.5 }, /expected_revision/],
			["a string revision", { action: "apply", expected_revision: "3" }, /expected_revision/],
			["select without a target", { action: "select", expected_revision: 1 }, /target must be/],
			[
				"an unknown target",
				{ action: "select", target: "uv", expected_revision: 1 },
				/target must be/,
			],
			[
				"a Conda target without a prefix",
				{ action: "select", target: "conda", expected_revision: 1 },
				/absolute Conda prefix.*desktop_environments_conda_envs_list/,
			],
			[
				"a Conda environment name instead of its prefix",
				{ action: "select", target: "conda", prefix: "lumen", expected_revision: 1 },
				/absolute Conda prefix.*got "lumen"/,
			],
			[
				"a kernelspec target without a name",
				{ action: "select", target: "kernelspec", expected_revision: 1 },
				/kernelspec name/,
			],
			[
				"a prefix on an automatic target",
				{ action: "select", target: "automatic", prefix: LUMEN.prefix, expected_revision: 1 },
				/prefix only applies to target conda/,
			],
			[
				"a name on a Conda target",
				{
					action: "select",
					target: "conda",
					prefix: LUMEN.prefix,
					name: "ir",
					expected_revision: 1,
				},
				/name only applies to target kernelspec/,
			],
		])("refuses %s before opening the notebook", async (_name, args, message) => {
			const openNotebook = vi.fn();
			const hooks = await createNteractKiloPlugin({
				loadRuntimedNode: () => ({ openNotebook }),
			})();

			await expect(
				hooks.tool.notebooks_environment.execute(
					{ notebook_id: NOTEBOOK_ID, ...args } as never,
					toolContext(),
				),
			).rejects.toThrow(message);
			expect(openNotebook).not.toHaveBeenCalled();
		});

		it("points agents at the Conda environment list instead of kernelspec registration", async () => {
			const hooks = await hooksFor(selectionSession());

			expect(hooks.tool.notebooks_environment.description).toMatch(
				/desktop_environments_conda_envs_list/,
			);
			expect(hooks.tool.notebooks_environment.description).toMatch(/kernelspec/);
		});
	});

	describe("dependency outcomes", () => {
		type TypedSync = {
			status: "applied" | "restart_required" | "failed";
			syncedPackages: string[];
			needsRestart: boolean;
			error?: string;
			nextAction: "none" | "restart" | "inspect";
		};

		function dependencySession(
			sync: { typed: () => Promise<TypedSync> } | { legacy: () => Promise<void> },
		) {
			return {
				notebookId: NOTEBOOK_ID,
				addDependencies: vi.fn(async () => undefined),
				removeDependencies: vi.fn(async () => 1),
				syncEnvironment: vi.fn("legacy" in sync ? sync.legacy : async () => undefined),
				...("typed" in sync ? { syncEnvironmentResult: vi.fn(sync.typed) } : {}),
				restartKernel: vi.fn(async () => undefined),
				runCell: vi.fn(),
				getDependencyStatus: vi.fn(async () => ({
					conda: { dependencies: ["pandas"], channels: ["conda-forge"] },
					fingerprint: "deps-2",
					trust: { status: "trusted", needsApproval: false },
				})),
				dependencyFingerprint: vi.fn(async () => "deps-2"),
				getRuntimeStatus: vi.fn(async () => ({
					status: "idle",
					lifecycle: "Running",
					activity: "Idle",
					startingPhase: "",
					name: "python3",
					language: "python",
					envSource: "uv:inline",
					runtimeAgentId: "runtime-1",
				})),
				close: vi.fn(async () => undefined),
			};
		}

		async function dependencies(session: ReturnType<typeof dependencySession>, args: object) {
			const hooks = await createNteractKiloPlugin({
				loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
			})();
			const result = await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, ...args } as never,
				toolContext(),
			);
			return { result, output: JSON.parse(result.output) };
		}

		const ADD_CONDA = { action: "add", packages: ["pandas"], package_manager: "conda" };

		it("records a Conda add on a uv kernel and reports the typed restart_required without restarting", async () => {
			const why = "Conda dependencies changed; the uv kernel cannot hot-install them.";
			const session = dependencySession({
				typed: async () => ({
					status: "restart_required",
					syncedPackages: [],
					needsRestart: true,
					error: why,
					nextAction: "restart",
				}),
			});

			const { result, output } = await dependencies(session, ADD_CONDA);

			expect(session.addDependencies).toHaveBeenCalledWith(["pandas"], { packageManager: "conda" });
			expect(session.syncEnvironment).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
			expect(result.title).toBe("Notebook dependencies recorded; restart required to use them");
			expect(output.declaration).toEqual({
				recorded: true,
				packages: ["pandas"],
				package_manager: "conda",
			});
			expect(output.environment_sync).toEqual({
				status: "restart_required",
				synced_packages: [],
				needs_restart: true,
				next_action: "restart",
				error: why,
				next_step: expect.stringMatching(
					/notebooks_kernel action restart.*Nothing restarts automatically/s,
				),
			});
			expect(output.kernel).toEqual({
				lifecycle: "Running",
				status: "idle",
				env_source: "uv:inline",
			});
			expect(result.metadata).toMatchObject({
				declaration_recorded: true,
				sync: "restart_required",
			});
		});

		it("reports a typed applied sync with the packages the daemon installed", async () => {
			const session = dependencySession({
				typed: async () => ({
					status: "applied",
					syncedPackages: ["pandas"],
					needsRestart: false,
					nextAction: "none",
				}),
			});

			const { result, output } = await dependencies(session, ADD_CONDA);

			expect(result.title).toBe("Notebook dependencies");
			expect(output.environment_sync).toEqual({
				status: "applied",
				synced_packages: ["pandas"],
				needs_restart: false,
				next_action: "none",
			});
		});

		it("points a typed failure at inspection, not a restart", async () => {
			const session = dependencySession({
				typed: async () => ({
					status: "failed",
					syncedPackages: [],
					needsRestart: false,
					error: "solver failed: pandas conflicts with python 3.14",
					nextAction: "inspect",
				}),
			});

			const { result, output } = await dependencies(session, {
				action: "remove",
				packages: ["polars"],
			});

			expect(result.title).toBe("Notebook dependencies recorded; environment not updated");
			expect(output.declaration).toEqual({ recorded: true, packages: ["polars"], removed: 1 });
			expect(output.environment_sync).toMatchObject({
				status: "failed",
				next_action: "inspect",
				error: "solver failed: pandas conflicts with python 3.14",
				next_step: expect.stringMatching(/notebooks_diagnose.*will not necessarily fix/s),
			});
		});

		it("reports an interrupted typed sync as unknown, not as safe to retry", async () => {
			const session = dependencySession({
				typed: async () => {
					throw new Error("Not connected");
				},
			});

			const { output } = await dependencies(session, ADD_CONDA);

			expect(output.declaration.recorded).toBe(true);
			expect(output.environment_sync).toEqual({
				status: "unknown",
				error: "Not connected",
				next_step: expect.stringMatching(/unknown.*before retrying/s),
			});
		});

		it("keeps a recorded add when an untyped sync rejects, without inventing restart_required", async () => {
			const session = dependencySession({
				legacy: async () => {
					throw new Error("Conda dependencies changed; restart the kernel to use them.");
				},
			});

			const { output } = await dependencies(session, ADD_CONDA);

			expect(output.declaration.recorded).toBe(true);
			expect(output.environment_sync).toEqual({
				status: "not_applied",
				typed: false,
				error: "Conda dependencies changed; restart the kernel to use them.",
				next_step: expect.stringMatching(/does not say whether a restart.*notebooks_diagnose/s),
			});
			expect(JSON.stringify(output)).not.toMatch(/restart_required/);
			expect(session.restartKernel).not.toHaveBeenCalled();
		});

		it("reports a sync-only action without a declaration", async () => {
			const session = dependencySession({ legacy: async () => undefined });

			const { result, output } = await dependencies(session, { action: "sync" });

			expect(output).not.toHaveProperty("declaration");
			expect(output.environment_sync).toEqual({ status: "applied", typed: false });
			expect(result.metadata).not.toHaveProperty("declaration_recorded");
		});

		it("says run_cell dependencies were recorded when their sync does not apply, and runs nothing", async () => {
			const session = dependencySession({
				typed: async () => ({
					status: "restart_required",
					syncedPackages: [],
					needsRestart: true,
					error: "kernel must restart",
					nextAction: "restart",
				}),
			});
			const hooks = await createNteractKiloPlugin({
				loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
			})();

			await expect(
				hooks.tool.notebooks_run_cell.execute(
					{ notebook_id: NOTEBOOK_ID, code: "import pandas", dependencies: ["pandas"] },
					toolContext(),
				),
			).rejects.toThrow(
				/Recorded pandas in the notebook.*ended restart_required.*not run: kernel must restart.*notebooks_kernel action restart/s,
			);
			expect(session.runCell).not.toHaveBeenCalled();
			expect(session.restartKernel).not.toHaveBeenCalled();
		});
	});

	it("does not report a launching kernel's environment as current after restart", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			restartKernel: vi.fn(async () => undefined),
			getRuntimeStatus: vi.fn(async () => ({
				status: "starting",
				lifecycle: "Launching",
				startingPhase: "launching",
				name: "",
				language: "",
				envSource: "uv:inline",
				runtimeAgentId: "",
			})),
			close: vi.fn(async () => undefined),
		};
		const hooks = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		const output = JSON.parse(
			(
				await hooks.tool.notebooks_kernel.execute(
					{ notebook_id: NOTEBOOK_ID, action: "restart" },
					toolContext(),
				)
			).output,
		);

		expect(output.status).not.toHaveProperty("envSource");
		expect(output).toMatchObject({
			status: { lifecycle: "Launching" },
			unconfirmed: { envSource: "uv:inline" },
			summary: expect.stringMatching(/Launching.*not confirmed/),
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

		const savedPath = path.resolve("/projects/demo/reports/analysis.ipynb");
		expect(session.saveNotebook).toHaveBeenCalledWith(savedPath);
		expect(ask).not.toHaveBeenCalled();
		expect(result).toEqual({
			title: "Notebook saved",
			output: savedPath,
			metadata: {
				notebook_id: NOTEBOOK_ID,
				path: savedPath,
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

		const externalPath = path.resolve("/exports/analysis.ipynb");
		expect(ask).toHaveBeenCalledWith({
			permission: "external_directory",
			patterns: [externalPath],
			always: [],
			metadata: { notebook_id: NOTEBOOK_ID, path: externalPath },
		});
		expect(session.saveNotebook).toHaveBeenCalledWith(externalPath);
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

describe("notebook_id contract", () => {
	type AnyTool = {
		execute(args: unknown, context: ReturnType<typeof toolContext>): Promise<unknown>;
	};

	async function pluginWithSpy() {
		const openNotebook = vi.fn();
		const hooks = await createNteractKiloPlugin({ loadRuntimedNode: () => ({ openNotebook }) })();
		const tool = (name: keyof typeof hooks.tool) => hooks.tool[name] as AnyTool;
		return { openNotebook, tool };
	}

	const minimalArgs: Record<string, Record<string, unknown>> = {
		notebooks_create_cell: {},
		notebooks_dependencies: { action: "status" },
		notebooks_environment: { action: "status" },
		notebooks_edit_cells: { operations: [{ action: "delete", cell_id: "cell-1" }] },
		notebooks_execute: {},
		notebooks_kernel: { action: "status" },
		notebooks_read: {},
		notebooks_run_cell: { code: "1" },
		notebooks_save: {},
	};

	it.each(Object.entries(minimalArgs))(
		"%s refuses a placeholder notebook_id before reaching the daemon",
		async (toolName, args) => {
			const { openNotebook, tool } = await pluginWithSpy();

			await expect(
				tool(toolName as never).execute({ notebook_id: "?", ...args }, toolContext()),
			).rejects.toThrow(/notebook_id must be a notebook UUID.*desktop_notebook_list_open/);
			expect(openNotebook).not.toHaveBeenCalled();
		},
	);

	it("redirects a workspace notebook name to desktop_notebook_open_file without opening it", async () => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "notebook-id-workspace-"));
		await mkdir(path.join(workspace, "reports"));
		await writeFile(path.join(workspace, "reports", "q3.ipynb"), "{}");
		const resolved = await realpath(path.join(workspace, "reports", "q3.ipynb"));
		const { openNotebook, tool } = await pluginWithSpy();

		const attempt = tool("notebooks_read").execute(
			{ notebook_id: "reports/q3.ipynb" },
			toolContext({ worktree: workspace }),
		);

		await expect(attempt).rejects.toThrow(
			`open it with desktop_notebook_open_file {"path": ${JSON.stringify(resolved)}}`,
		);
		expect(openNotebook).not.toHaveBeenCalled();
	});

	it("does not redirect notebooks outside the workspace, including through symlinks", async () => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "notebook-id-workspace-"));
		const elsewhere = await mkdtemp(path.join(os.tmpdir(), "notebook-id-elsewhere-"));
		const outside = path.join(elsewhere, "private.ipynb");
		await writeFile(outside, "{}");
		await symlink(outside, path.join(workspace, "linked.ipynb"));
		const { openNotebook, tool } = await pluginWithSpy();

		for (const notebookId of [outside, "linked.ipynb", "../private.ipynb"]) {
			const attempt = tool("notebooks_read").execute(
				{ notebook_id: notebookId },
				toolContext({ worktree: workspace }),
			);
			await expect(attempt).rejects.toThrow(
				`notebook_id must be a notebook UUID from desktop_notebook_list_open or desktop_notebook_open_file; got ${JSON.stringify(notebookId)}.`,
			);
		}
		expect(openNotebook).not.toHaveBeenCalled();
	});
});
