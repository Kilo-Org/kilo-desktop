import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { requireNotebookPrompt } from "./index";
import { bootPlugin, textOf, type PermissionCheck } from "./test-host";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";

function toolContext(overrides: Partial<{ signal: AbortSignal; worktree: string }> = {}) {
	return {
		sessionID: "kilo-session-1",
		messageID: "message-1",
		agent: "code",
		directory: "/projects/demo",
		worktree: overrides.worktree ?? "/projects/demo",
		signal: overrides.signal ?? new AbortController().signal,
		assert: vi.fn(async () => undefined),
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(hooks.tool.notebooks_create_cell.description).toMatch(/^Create a notebook cell/);
		expect(session.createCell).toHaveBeenCalledWith("print('created')", {
			cellType: "code",
			afterCellId: "cell-1",
		});
		expect(session.executeCell).toHaveBeenCalledWith("cell-created", { timeoutMs: 30_000 });
		expect(result).toEqual({
			content: "cell cell-created [4] done\ncreated",
			metadata: {
				title: "Notebook cell created and executed",
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
		const plugin = bootPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		});
		const hooks = await plugin();

		const result = await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "print('answer:', 42)" },
			{
				sessionID: "kilo-session-1",
				messageID: "message-1",
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(result).toEqual({
			content: [
				{ type: "text", text: "cell cell-7 [7] done\nanswer: 42" },
				{ type: "file", mime: "image/png", uri: "data:image/png;base64,AAAA" },
			],
			metadata: {
				title: "Notebook cell 7",
				notebook_id: NOTEBOOK_ID,
				cell_id: "cell-7",
				execution_id: "execution-7",
				execution_count: 7,
				status: "done",
				success: true,
			},
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(JSON.parse(textOf(result))).toEqual({
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
		expect(result.metadata?.title).toBe("Notebook contents");
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(JSON.parse(textOf(result))).toEqual({
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
			z.safeParse(hooks.tool.notebooks_edit_cells.input, {
				notebook_id: NOTEBOOK_ID,
				operations: [{ action: "create", source: "# Analysis", cell_type: "markdown" }],
			}).success,
		).toBe(false);
	});

	it("rejects edit operations with misspelled keys instead of dropping them", async () => {
		const hooks = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn() }),
		})();

		expect(
			z.safeParse(hooks.tool.notebooks_edit_cells.input, {
				notebook_id: NOTEBOOK_ID,
				operations: [
					{ action: "update", cell_id: "cell-1", "source/remove the kernel line": "x = 1" },
				],
			}).success,
		).toBe(false);
	});

	it("refuses updates that change nothing before applying any operation", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async () => true),
			deleteCell: vi.fn(async () => true),
			close: vi.fn(async () => undefined),
		};
		const hooks = await bootPlugin({
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
		const hooks = await bootPlugin({
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
		const hooks = await bootPlugin({
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
		const hooks = await bootPlugin({
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(textOf(result)).toBe("cell cell-1 [1] done\none\n\ncell cell-2 [2] done\ntwo");
		expect(result.metadata).toMatchObject({
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(session.addDependencies).toHaveBeenCalledWith(["polars>=1"], {
			packageManager: "uv",
		});
		expect(session.syncEnvironment).toHaveBeenCalledOnce();
		expect(JSON.parse(textOf(result))).toEqual({
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		expect(session.restartKernel).toHaveBeenCalledOnce();
		expect(JSON.parse(textOf(result))).toEqual({
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

	describe("notebooks_diagnose", () => {
		const CONDA_ERROR =
			"Failed to create conda env 'notebook-test' from environment.yml: Failed to fetch package metadata: HTTP status client error (403 Forbidden)";

		function diagnoseHooks(session: Record<string, unknown>) {
			return bootPlugin({
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

			expect(result.metadata?.title).toBe("Notebook error diagnosed");
			expect(result.metadata).toMatchObject({ notebook_id: NOTEBOOK_ID, has_error: true });
			expect(JSON.parse(textOf(result))).toEqual({
				notebook_id: NOTEBOOK_ID,
				summary: `Kernel failed to start: conda_env_build_failed: ${CONDA_ERROR}`,
				kernel_error: { reason: "conda_env_build_failed", details: CONDA_ERROR },
				kernel: {
					lifecycle: "Error",
					status: "error",
					starting_phase: "",
					env_source: "conda:env_yml",
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

			expect(result.metadata).toMatchObject({ notebook_id: NOTEBOOK_ID, has_error: false });
			expect(JSON.parse(textOf(result))).toMatchObject({
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
					.content as string,
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

			expect(JSON.parse(textOf(result))).toEqual({
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

		type AskRequest = PermissionCheck;

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
			return bootPlugin({
				loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
			})();
		}

		function approving() {
			return vi.fn(async (_request: AskRequest) => undefined);
		}

		function contextWithAssert(ask: ReturnType<typeof vi.fn>) {
			return { ...toolContext(), assert: ask as never };
		}

		it("makes dependency and execution approval prompt even when the agent allows every permission", async () => {
			const hooks = await hooksFor(approvalSession());
			const allowAll = { action: "*", resource: "*", effect: "allow" };
			const evaluate = (
				action: string,
				rules: { action: string; resource: string; effect: string }[] | undefined,
				resources = [`ses_x:${NOTEBOOK_ID}`],
			) =>
				hooks.evaluate({ action, resources, effect: "allow", ...(rules ? { rules } : {}) }).effect;

			// Kilo's built-in agents allow every action.
			expect(evaluate("notebooks_execute", [allowAll])).toBe("ask");
			expect(evaluate("notebooks_trust", [allowAll], ["uv: evil-pkg"])).toBe("ask");
			// Without the rules Kilo evaluated, an allow can't be trusted.
			expect(evaluate("notebooks_execute", undefined)).toBe("ask");
			// The user's own rule, and Kilo's saved "Always allow" for this scope, stand.
			expect(
				evaluate("notebooks_execute", [
					allowAll,
					{ action: "notebooks_execute", resource: "*", effect: "allow" },
				]),
			).toBe("allow");
			expect(
				evaluate("notebooks_execute", [
					allowAll,
					{ action: "notebooks_execute", resource: `ses_x:${NOTEBOOK_ID}`, effect: "allow" },
				]),
			).toBe("allow");
			// A saved allow for another notebook doesn't cover this one.
			expect(
				evaluate("notebooks_execute", [
					allowAll,
					{ action: "notebooks_execute", resource: "ses_x:other", effect: "allow" },
				]),
			).toBe("ask");
			// Every resource must be covered.
			expect(
				evaluate(
					"notebooks_trust",
					[allowAll, { action: "notebooks_trust", resource: "uv: numpy", effect: "allow" }],
					["uv: numpy", "uv: evil-pkg"],
				),
			).toBe("ask");
			// Other actions, and decisions other than allow, are left alone.
			expect(evaluate("shell", [allowAll], ["ls"])).toBe("allow");
			expect(
				hooks.evaluate({ action: "notebooks_execute", resources: ["x"], effect: "deny" }).effect,
			).toBe("deny");
			expect(requireNotebookPrompt).toBeTypeOf("function");
		});

		it("adds default-approved packages to a trusted notebook without asking", async () => {
			const session = approvalSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["pandas>=2", "conda-forge::numpy"] },
				contextWithAssert(ask),
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
				contextWithAssert(ask),
			);

			expect(ask).toHaveBeenCalledWith({
				action: "notebooks_trust",
				resources: ["requests"],
				save: ["requests"],
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
				contextWithAssert(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({
				resources: ["uv: evil-pkg", "requests"],
				save: ["requests"],
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
					contextWithAssert(ask),
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
				contextWithAssert(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({
				resources: ["numppy (similar to numpy)"],
				save: [],
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
					contextWithAssert(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_run_cell.execute(
					{ notebook_id: NOTEBOOK_ID, code: "import requests", dependencies: ["requests"] },
					contextWithAssert(ask),
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
					contextWithAssert(approving()),
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
				contextWithAssert(ask),
			);
			await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg", "other-pkg"] },
				contextWithAssert(ask),
			);

			expect(ask).toHaveBeenCalledOnce();
			expect(ask.mock.calls[0]?.[0]).toMatchObject({ resources: ["uv: other-pkg"], save: [] });
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
				contextWithAssert(ask),
			);

			expect(ask).toHaveBeenCalledWith({
				action: "notebooks_trust",
				resources: ["uv: numppy (similar to numpy)", "pixi-pypi: polars"],
				save: [],
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
				contextWithAssert(ask),
			);
			await hooks.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["evil-pkg>=1"] },
				contextWithAssert(ask),
			);

			// The exact spec is listed once, as the notebook's own dependency.
			expect(ask.mock.calls[0]?.[0]).toMatchObject({ resources: ["uv: evil-pkg"], save: [] });
			// A different spec for the same package is shown but still not rememberable.
			expect(ask.mock.calls[1]?.[0]).toMatchObject({
				resources: ["uv: evil-pkg", "evil-pkg"],
				save: [],
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
				contextWithAssert(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({
				resources: ["conda channel: my-org"],
				save: [],
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
				contextWithAssert(ask),
			);

			expect(ask.mock.calls[0]?.[0]).toMatchObject({ resources: ["conda channel: my-org"] });
			expect(session.approveTrust).toHaveBeenCalledOnce();
		});

		it("does not ask or approve when nothing needs approval", async () => {
			const session = approvalSession();
			const ask = approving();

			const result = await (
				await hooksFor(session)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				contextWithAssert(ask),
			);

			expect(ask).not.toHaveBeenCalled();
			expect(session.approveTrust).not.toHaveBeenCalled();
			expect(JSON.parse(textOf(result))).not.toHaveProperty("approval");
		});

		it("reports what needs approval in dependency status and diagnosis", async () => {
			const hooks = await hooksFor(approvalSession(UNTRUSTED_STATUS));

			const status = JSON.parse(
				(
					await hooks.tool.notebooks_dependencies.execute(
						{ notebook_id: NOTEBOOK_ID, action: "status" },
						toolContext(),
					)
				).content as string,
			);
			const diagnosis = JSON.parse(
				(await hooks.tool.notebooks_diagnose.execute({ notebook_id: NOTEBOOK_ID }, toolContext()))
					.content as string,
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
		type AskRequest = PermissionCheck;

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
			return bootPlugin({
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

		function contextWithAssert(ask: ReturnType<typeof vi.fn>) {
			return { ...toolContext(), assert: ask as never };
		}

		it("asks once, per notebook, before run_cell executes code", async () => {
			const session = executionSession();
			const ask = approving();

			await (
				await hooksFor(session)
			).tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "print('hi')" },
				contextWithAssert(ask),
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith({
				action: "notebooks_execute",
				resources: [SESSION_SCOPE],
				save: [SESSION_SCOPE],
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
				contextWithAssert(ask),
			);

			expect(ask.mock.calls.map(([request]) => request.action)).toEqual([
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
					contextWithAssert(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_create_cell.execute(
					{ notebook_id: NOTEBOOK_ID, source: "1", and_run: true },
					contextWithAssert(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_execute.execute(
					{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1"] },
					contextWithAssert(ask),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				hooks.tool.notebooks_kernel.execute(
					{ notebook_id: NOTEBOOK_ID, action: "restart" },
					contextWithAssert(ask),
				),
			).rejects.toThrow(/rejected/);

			expect(ask).toHaveBeenCalledTimes(4);
			expect(ask.mock.calls.every(([request]) => request.action === "notebooks_execute")).toBe(
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
				contextWithAssert(ask),
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					action: "notebooks_execute",
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
				contextWithAssert(ask),
			);
			await hooks.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "# t", cell_type: "markdown", and_run: true },
				contextWithAssert(ask),
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
				contextWithAssert(ask),
			);

			expect(ask).toHaveBeenCalledExactlyOnceWith({
				action: "notebooks_execute",
				resources: [SESSION_SCOPE],
				save: [SESSION_SCOPE],
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

			await hooks.tool.notebooks_execute.execute(
				{ notebook_id: NOTEBOOK_ID },
				contextWithAssert(ask),
			);
			expect(ask.mock.calls[0]?.[0].metadata).toMatchObject({
				title: "Run all code cells?",
				cell_ids: ["cell-1"],
				cell_numbers: [2],
				all_cells: true,
			});

			session.listCells.mockResolvedValueOnce([]);
			await hooks.tool.notebooks_execute.execute(
				{ notebook_id: NOTEBOOK_ID },
				contextWithAssert(ask),
			);
			expect(ask).toHaveBeenCalledOnce();
		});

		it("asks before restarting the kernel but not to interrupt or inspect it", async () => {
			const session = executionSession();
			const hooks = await hooksFor(session);
			const ask = approving();

			await hooks.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "status" },
				contextWithAssert(ask),
			);
			await hooks.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "interrupt" },
				contextWithAssert(ask),
			);
			expect(ask).not.toHaveBeenCalled();

			await hooks.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "restart" },
				contextWithAssert(ask),
			);
			expect(ask).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					action: "notebooks_execute",
					resources: [SESSION_SCOPE],
					save: [SESSION_SCOPE],
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
		type Context = ReturnType<typeof contextWithAssert>;
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
				const inSession = (sessionID: string) => ({ ...contextWithAssert(ask), sessionID });

				await run(hooks, NOTEBOOK_ID, inSession("kilo-session-1"));
				await run(hooks, NOTEBOOK_ID, inSession("kilo-session-2"));
				await run(hooks, OTHER_NOTEBOOK_ID, inSession("kilo-session-1"));

				expect(ask.mock.calls.map(([request]) => [request.resources, request.save])).toEqual([
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
			const cancelled = { ...contextWithAssert(ask), signal: aborted.signal };

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
				hooks.tool.notebooks_run_cell.execute(
					{ notebook_id: "?", code: "1" },
					contextWithAssert(ask),
				),
			).rejects.toThrow(/notebook_id must be a notebook UUID/);

			expect(ask).not.toHaveBeenCalled();
		});
	});

	it("saves a notebook to a path inside the Kilo workspace", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: ask,
			},
		);

		const savedPath = path.resolve("/projects/demo/reports/analysis.ipynb");
		expect(session.saveNotebook).toHaveBeenCalledWith(savedPath);
		expect(ask).not.toHaveBeenCalled();
		expect(result).toEqual({
			content: savedPath,
			metadata: {
				title: "Notebook saved",
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: ask,
			},
		);

		const externalPath = path.resolve("/exports/analysis.ipynb");
		expect(ask).toHaveBeenCalledWith({
			action: "external_directory",
			resources: [externalPath],
			save: [],
			metadata: { notebook_id: NOTEBOOK_ID, path: externalPath },
		});
		expect(session.saveNotebook).toHaveBeenCalledWith(externalPath);
	});

	describe("notebook location", () => {
		async function workspaceWithOutsideNotebook() {
			const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nteract-location-")));
			const workspace = path.join(root, "workspace");
			const outside = path.join(root, "outside");
			await mkdir(workspace);
			await mkdir(outside);
			await writeFile(path.join(workspace, "inside.ipynb"), "{}");
			await writeFile(path.join(outside, "notes.ipynb"), "{}");
			await symlink(path.join(outside, "notes.ipynb"), path.join(workspace, "linked.ipynb"));
			await symlink(outside, path.join(workspace, "exports"));
			await symlink(path.join(outside, "missing.ipynb"), path.join(workspace, "dangling.ipynb"));
			return { workspace, outside };
		}

		async function pluginWithNotebookAt(notebookPath: string) {
			const session = {
				notebookId: NOTEBOOK_ID,
				listCells: vi.fn(async () => []),
				getExecutionView: vi.fn(() => ({ cell_execution_ids: {}, executions: {} })),
				saveNotebook: vi.fn(async () => undefined),
				close: vi.fn(async () => undefined),
			};
			const hooks = await bootPlugin({
				loadRuntimedNode: () => ({
					openNotebook: vi.fn(async () => session),
					listActiveNotebooks: vi.fn(async () => [{ notebookId: NOTEBOOK_ID, notebookPath }]),
				}),
			})();
			return { hooks, session };
		}

		function contextIn(workspace: string, ask: () => Promise<void>) {
			return { ...toolContext({ worktree: workspace }), directory: workspace, assert: ask };
		}

		it("reads a workspace notebook without asking", async () => {
			const { workspace } = await workspaceWithOutsideNotebook();
			const { hooks, session } = await pluginWithNotebookAt(path.join(workspace, "inside.ipynb"));
			const ask = vi.fn(async () => undefined);

			await hooks.tool.notebooks_read.execute(
				{ notebook_id: NOTEBOOK_ID },
				contextIn(workspace, ask),
			);

			expect(ask).not.toHaveBeenCalled();
			expect(session.listCells).toHaveBeenCalledOnce();
		});

		it("asks once per Kilo session before reading a notebook whose file is outside the workspace", async () => {
			const { workspace, outside } = await workspaceWithOutsideNotebook();
			const { hooks, session } = await pluginWithNotebookAt(path.join(workspace, "linked.ipynb"));
			const ask = vi
				.fn<() => Promise<void>>()
				.mockRejectedValueOnce(new Error("rejected"))
				.mockResolvedValue(undefined);
			const context = contextIn(workspace, ask);
			const read = () => hooks.tool.notebooks_read.execute({ notebook_id: NOTEBOOK_ID }, context);

			await expect(read()).rejects.toThrow("rejected");
			expect(session.listCells).not.toHaveBeenCalled();
			await read();
			await read();

			expect(ask).toHaveBeenCalledTimes(2);
			expect(ask).toHaveBeenLastCalledWith({
				action: "external_directory",
				resources: [path.join(outside, "*")],
				save: [path.join(outside, "*")],
				metadata: expect.objectContaining({
					filepath: path.join(outside, "notes.ipynb"),
					parentDir: outside,
					notebook_id: NOTEBOOK_ID,
				}),
			});
			expect(session.listCells).toHaveBeenCalledTimes(2);
		});

		it.each([
			[
				"a new folder under a workspace symlink to an outside folder",
				"exports/new/copy.ipynb",
				["new", "copy.ipynb"],
			],
			["a workspace symlink to a missing outside file", "dangling.ipynb", ["missing.ipynb"]],
		])("asks once per session before saving to %s", async (_, savePath, outsideParts) => {
			const { workspace, outside } = await workspaceWithOutsideNotebook();
			const { hooks, session } = await pluginWithNotebookAt(path.join(workspace, "inside.ipynb"));
			const ask = vi.fn(async () => undefined);
			const context = contextIn(workspace, ask);
			const save = () =>
				hooks.tool.notebooks_save.execute({ notebook_id: NOTEBOOK_ID, path: savePath }, context);

			await save();
			await save();

			expect(ask).toHaveBeenCalledOnce();
			expect(ask).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "external_directory",
					resources: [path.join(outside, ...outsideParts)],
				}),
			);
			expect(session.saveNotebook).toHaveBeenCalledTimes(2);
		});
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
		const hooks = await bootPlugin({
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
				agent: "code",
				directory: "/projects/demo",
				worktree: "/projects/demo",
				signal: new AbortController().signal,
				assert: vi.fn(async () => undefined),
			},
		);

		await hooks.emit({ type: "session.deleted", data: { sessionID: "kilo-session-1" } });

		expect(session.close).toHaveBeenCalledOnce();
	});

	it("rejects a runtimed module that does not export openNotebook", async () => {
		await expect(bootPlugin({ loadRuntimedNode: () => ({}) })()).rejects.toThrow(
			/does not export openNotebook/,
		);
		await expect(bootPlugin({ loadRuntimedNode: () => null })()).rejects.toThrow(
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
		const hooks = await bootPlugin({
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
		const hooks = await bootPlugin({
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

		await hooks.emit({ type: "session.deleted", data: { sessionID: "kilo-session-1" } });
		expect(session.close).not.toHaveBeenCalled();

		await hooks.emit({ type: "file.edited" });
		await hooks.emit({ type: "session.deleted", data: { sessionID: "kilo-session-2" } });
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
		const hooks = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();

		const result = await hooks.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "raise ValueError('bad')" },
			toolContext(),
		);

		expect(textOf(result)).toContain("[stderr] warn");
		expect(textOf(result)).toContain("Traceback (most recent call last):");
		expect(textOf(result)).toContain("[update_display_data output]");
	});

	it("refuses cancelled run and create calls and missing cells", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			getCell: vi.fn(async () => null),
			createCell: vi.fn(),
			runCell: vi.fn(),
			close: vi.fn(async () => undefined),
		};
		const hooks = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		})();
		const aborted = new AbortController();
		aborted.abort();

		await expect(
			hooks.tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "1" },
				toolContext({ signal: aborted.signal }),
			),
		).rejects.toThrow(/cancelled/);
		await expect(
			hooks.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "1" },
				toolContext({ signal: aborted.signal }),
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
		const hooks = await bootPlugin({
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
		expect(JSON.parse(textOf(result))).toEqual({
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
		const hooks = await bootPlugin({
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
		const hooks = await bootPlugin({
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
		expect(JSON.parse(textOf(status)).action).toBe("status");
	});

	it("interrupts the kernel and saves to the notebook's current path", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			interruptKernel: vi.fn(async () => undefined),
			getRuntimeStatus: vi.fn(async () => ({ status: "idle" })),
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const hooks = await bootPlugin({
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
		expect(textOf(saved)).toBe("Saved to the notebook's current path.");
	});
});

describe("notebook_id contract", () => {
	type AnyTool = {
		execute(args: unknown, context: ReturnType<typeof toolContext>): Promise<unknown>;
	};

	async function pluginWithSpy() {
		const openNotebook = vi.fn();
		const hooks = await bootPlugin({ loadRuntimedNode: () => ({ openNotebook }) })();
		const tool = (name: keyof typeof hooks.tool) => hooks.tool[name] as AnyTool;
		return { openNotebook, tool };
	}

	const minimalArgs: Record<string, Record<string, unknown>> = {
		notebooks_create_cell: {},
		notebooks_dependencies: { action: "status" },
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
