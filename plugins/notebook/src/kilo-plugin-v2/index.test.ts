import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createNteractKiloPlugin, requireNotebookPrompts } from "./index";
import type {
	KiloEvent,
	PermissionAssertInput,
	PermissionRule,
	PluginContext,
	Tool,
	ToolContext,
	ToolResult,
} from "./kilo-api";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";
const DIRECTORY = "/projects/demo";

type AgentTransform = Parameters<PluginContext["agent"]["transform"]>[0];

let callCount = 0;

/** A Kilo v2 tool context for one call; each call gets its own `id`. */
function toolContext(overrides: Partial<ToolContext> = {}) {
	return {
		sessionID: "kilo-session-1",
		agent: "build",
		messageID: "message-1",
		id: `call-${++callCount}`,
		signal: new AbortController().signal,
		progress: vi.fn(async (_update: Record<string, unknown>) => undefined),
		...overrides,
	};
}

/** The `permission.assert` input a tool call made through `toolContext()` sends. */
function permissionRequest(
	request: Pick<PermissionAssertInput, "action" | "resources" | "save" | "metadata">,
) {
	return {
		sessionID: "kilo-session-1",
		agent: "build",
		...request,
		source: { type: "tool", messageID: "message-1", id: expect.stringMatching(/^call-/) },
	};
}

function allowing() {
	return vi.fn(async (_input: PermissionAssertInput) => undefined);
}

function rejecting() {
	return vi.fn(async (_input: PermissionAssertInput) => {
		throw new Error("The user rejected permission to use this specific tool call.");
	});
}

/** The text content a tool result leads with. */
function text(result: ToolResult): string {
	const [first] = result.content;
	if (first?.type !== "text") throw new Error("a notebook tool result leads with text content");
	return first.text;
}

/** The model-facing JSON Schema Kilo derives from a tool's Standard Schema input. */
function jsonSchema(tool: Pick<Tool, "input">): Record<string, unknown> {
	return tool.input["~standard"].jsonSchema.input({ target: "draft-2020-12" });
}

/** Validates input against a tool's Standard Schema the way Kilo does before `execute()`. */
async function validated(tool: Pick<Tool, "input">, input: unknown): Promise<unknown> {
	const result = await tool.input["~standard"].validate(input);
	if (result.issues) {
		throw new Error(`invalid input: ${result.issues.map((issue) => issue.message).join(", ")}`);
	}
	return result.value;
}

/**
 * A pull-based event stream: `emit` resolves once the plugin asks for the next
 * event, i.e. after it has finished handling this one.
 */
function eventChannel() {
	const pending: Array<{ event: KiloEvent; handled: () => void }> = [];
	let waiter: ((result: IteratorResult<KiloEvent>) => void) | undefined;
	let current: (() => void) | undefined;
	let ended = false;
	const end = () => {
		ended = true;
		current?.();
		waiter?.({ value: undefined, done: true });
		waiter = undefined;
	};
	return {
		get ended() {
			return ended;
		},
		emit(event: KiloEvent): Promise<void> {
			return new Promise((handled) => {
				if (ended) return handled();
				if (waiter) {
					const resolve = waiter;
					waiter = undefined;
					current = handled;
					resolve({ value: event, done: false });
				} else pending.push({ event, handled });
			});
		},
		iterable(signal?: AbortSignal): AsyncIterable<KiloEvent> {
			signal?.addEventListener("abort", end, { once: true });
			return {
				[Symbol.asyncIterator]: () => ({
					next: () => {
						current?.();
						current = undefined;
						if (ended) return Promise.resolve({ value: undefined, done: true as const });
						const item = pending.shift();
						if (item) {
							current = item.handled;
							return Promise.resolve({ value: item.event, done: false as const });
						}
						return new Promise<IteratorResult<KiloEvent>>((resolve) => (waiter = resolve));
					},
					return: () => {
						end();
						return Promise.resolve({ value: undefined, done: true as const });
					},
				}),
			};
		},
	};
}

/** A fake Kilo v2 plugin context that records what the plugin registers. */
function fakeKilo(directory = DIRECTORY, assert = allowing()) {
	const tools = new Map<string, Tool>();
	const agentTransforms: AgentTransform[] = [];
	const subscriptions: Array<{ types: string[]; signal?: AbortSignal }> = [];
	const channel = eventChannel();
	const ctx: PluginContext = {
		location: { directory },
		tool: {
			transform: async (callback) => {
				callback({ add: (tool) => tools.set(tool.name, tool) });
				return { dispose: async () => undefined };
			},
		},
		agent: {
			transform: async (callback) => {
				agentTransforms.push(callback);
				return { dispose: async () => undefined };
			},
		},
		permission: { assert },
		event: {
			subscribe: (options) => {
				subscriptions.push(options);
				return channel.iterable(options.signal);
			},
		},
	};
	return { ctx, tools, agentTransforms, subscriptions, channel, assert };
}

type NotebookToolName =
	| "notebooks_create_cell"
	| "notebooks_dependencies"
	| "notebooks_diagnose"
	| "notebooks_edit_cells"
	| "notebooks_execute"
	| "notebooks_kernel"
	| "notebooks_read"
	| "notebooks_run_cell"
	| "notebooks_save";

type CallableTool = Omit<Tool, "execute"> & {
	execute(input: unknown, context: ToolContext): Promise<ToolResult>;
};

/**
 * Boots the plugin against a fake Kilo v2 context. Its tools validate input as
 * Kilo does before running, so calls exercise the registered schema too.
 */
async function bootPlugin(
	dependencies: Parameters<typeof createNteractKiloPlugin>[0],
	options: { directory?: string; assert?: ReturnType<typeof allowing> } = {},
) {
	const kilo = fakeKilo(options.directory, options.assert);
	const cleanup = await createNteractKiloPlugin(dependencies).setup(kilo.ctx);
	const tool = Object.fromEntries(
		[...kilo.tools].map(([name, registered]): [string, CallableTool] => [
			name,
			{
				...registered,
				execute: async (input, context) =>
					registered.execute((await validated(registered, input)) as never, context),
			},
		]),
	) as Record<NotebookToolName, CallableTool>;
	return {
		tool,
		kilo,
		cleanup,
		/** Delivers an event to the plugin's subscription, if it subscribed to its type. */
		emit: async (event: KiloEvent) => {
			if (kilo.subscriptions.some((subscription) => subscription.types.includes(event.type))) {
				await kilo.channel.emit(event);
			}
		},
	};
}

type OperationSchema = {
	properties: { action: { const: string } };
	additionalProperties?: boolean;
};

function editOperationSchemas(input: Record<string, unknown>): OperationSchema[] {
	const { operations } = input.properties as {
		operations: { items: { oneOf?: OperationSchema[]; anyOf?: OperationSchema[] } };
	};
	return operations.items.oneOf ?? operations.items.anyOf ?? [];
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		const result = await plugin.tool.notebooks_create_cell.execute(
			{
				notebook_id: NOTEBOOK_ID,
				source: "print('created')",
				cell_type: "code",
				after_cell_id: "cell-1",
				and_run: true,
				timeout_secs: 30,
			},
			toolContext(),
		);

		expect(plugin.tool.notebooks_create_cell.description).toMatch(/^Create a notebook cell/);
		expect(session.createCell).toHaveBeenCalledWith("print('created')", {
			cellType: "code",
			afterCellId: "cell-1",
		});
		expect(session.executeCell).toHaveBeenCalledWith("cell-created", { timeoutMs: 30_000 });
		expect(result).toEqual({
			content: [{ type: "text", text: "cell cell-created [4] done\ncreated" }],
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
		const plugin = await bootPlugin({ loadRuntimedNode: () => ({ openNotebook }) });

		const result = await plugin.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "print('answer:', 42)" },
			toolContext(),
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult,
			}),
		});

		const result = await plugin.tool.notebooks_read.execute(
			{ notebook_id: NOTEBOOK_ID, include_outputs: true },
			toolContext(),
		);

		expect(JSON.parse(text(result))).toEqual({
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
		expect(result.metadata.title).toBe("Notebook contents");
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		const result = await plugin.tool.notebooks_edit_cells.execute(
			{
				notebook_id: NOTEBOOK_ID,
				operations: [
					{ action: "update", cell_id: "cell-2", source: "value = 42" },
					{ action: "move", cell_id: "cell-2", after_cell_id: "cell-1" },
					{ action: "delete", cell_id: "cell-3" },
				],
			},
			toolContext(),
		);

		expect(JSON.parse(text(result))).toEqual({
			notebook_id: NOTEBOOK_ID,
			results: [
				{ action: "update", cell_id: "cell-2" },
				{ action: "move", cell_id: "cell-2", position: "a2" },
				{ action: "delete", cell_id: "cell-3" },
			],
		});
		expect(session.setCell).toHaveBeenCalledWith("cell-2", { source: "value = 42" });
		expect(session.moveCell).toHaveBeenCalledWith("cell-2", "cell-1");
		const operation = editOperationSchemas(jsonSchema(plugin.tool.notebooks_edit_cells));
		expect(operation.map((branch) => branch.properties.action.const)).toEqual([
			"update",
			"delete",
			"move",
		]);
	});

	it("refuses updates that change nothing before applying any operation", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async () => true),
			deleteCell: vi.fn(async () => true),
			close: vi.fn(async () => undefined),
		};
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		await expect(
			plugin.tool.notebooks_edit_cells.execute(
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		await expect(
			plugin.tool.notebooks_edit_cells.execute(
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});
		const moveTo = (cellId: string, afterCellId: string) =>
			plugin.tool.notebooks_edit_cells.execute(
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
			plugin.tool.notebooks_create_cell.execute(
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		});
		const edit = {
			notebook_id: NOTEBOOK_ID,
			operations: [{ action: "update" as const, cell_id: "cell-1", source: "a = 1" }],
		};

		emitStatus({ connection: "Connected", notebook_doc: "Interactive" });
		await plugin.tool.notebooks_edit_cells.execute(edit, toolContext());
		first.setCell.mockImplementationOnce(async () => {
			emitStatus({ connection: "Disconnected", notebook_doc: "Interactive" });
			return true;
		});

		await expect(plugin.tool.notebooks_edit_cells.execute(edit, toolContext())).rejects.toThrow(
			/notebook connection was lost/,
		);
		expect(first.close).toHaveBeenCalledOnce();
		expect(subscription.unsubscribe).toHaveBeenCalledOnce();

		await plugin.tool.notebooks_edit_cells.execute(edit, toolContext());
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		const result = await plugin.tool.notebooks_execute.execute(
			{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1", "cell-2"], timeout_secs: 30 },
			toolContext(),
		);

		expect(text(result)).toBe("cell cell-1 [1] done\none\n\ncell cell-2 [2] done\ntwo");
		expect(result.metadata).toEqual({
			title: "Executed 2 notebook cells",
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		const result = await plugin.tool.notebooks_dependencies.execute(
			{
				notebook_id: NOTEBOOK_ID,
				action: "add",
				packages: ["polars>=1"],
				package_manager: "uv",
			},
			toolContext(),
		);

		expect(session.addDependencies).toHaveBeenCalledWith(["polars>=1"], {
			packageManager: "uv",
		});
		expect(session.syncEnvironment).toHaveBeenCalledOnce();
		expect(JSON.parse(text(result))).toEqual({
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		const result = await plugin.tool.notebooks_kernel.execute(
			{ notebook_id: NOTEBOOK_ID, action: "restart" },
			toolContext(),
		);

		expect(session.restartKernel).toHaveBeenCalledOnce();
		expect(JSON.parse(text(result))).toEqual({
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

		function diagnosePlugin(session: Record<string, unknown>) {
			return bootPlugin({
				loadRuntimedNode: () => ({
					openNotebook: vi.fn(async () => ({
						notebookId: NOTEBOOK_ID,
						close: vi.fn(),
						...session,
					})),
				}),
			});
		}

		it("reports the kernel startup error the user sees in the notebook", async () => {
			const plugin = await diagnosePlugin({
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

			const result = await plugin.tool.notebooks_diagnose.execute(
				{ notebook_id: NOTEBOOK_ID },
				toolContext(),
			);

			expect(result.metadata).toEqual({
				title: "Notebook error diagnosed",
				notebook_id: NOTEBOOK_ID,
				has_error: true,
			});
			expect(JSON.parse(text(result))).toEqual({
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
			const plugin = await diagnosePlugin({
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

			const result = await plugin.tool.notebooks_diagnose.execute(
				{ notebook_id: NOTEBOOK_ID },
				toolContext(),
			);

			expect(result.metadata).toEqual({
				title: "Notebook diagnosed",
				notebook_id: NOTEBOOK_ID,
				has_error: false,
			});
			expect(JSON.parse(text(result))).toMatchObject({
				summary: "Kernel is running (Idle).",
				kernel_error: null,
			});
		});

		it("points at trust approval and still reports kernel state when dependency status fails", async () => {
			const plugin = await diagnosePlugin({
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
				text(
					await plugin.tool.notebooks_diagnose.execute({ notebook_id: NOTEBOOK_ID }, toolContext()),
				),
			);

			expect(output.summary).toMatch(/approve the notebook dependencies/);
			expect(output.summary).toMatch(/approve_trust/);
			expect(output.dependencies_error).toBe("dependency metadata unavailable");
			expect(output).not.toHaveProperty("dependencies");
		});

		it("adds the kernel error to notebooks_dependencies results", async () => {
			const plugin = await diagnosePlugin({
				getRuntimeStatus: vi.fn(async () => ({
					lifecycle: "Error",
					errorReason: "conda_env_build_failed",
					errorDetails: CONDA_ERROR,
				})),
				getDependencyStatus: vi.fn(async () => ({ fingerprint: "environment-1" })),
			});

			const result = await plugin.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "status" },
				toolContext(),
			);

			expect(JSON.parse(text(result))).toEqual({
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

		async function pluginFor(
			session: ReturnType<typeof approvalSession>,
			assert: ReturnType<typeof allowing> = allowing(),
		) {
			return bootPlugin(
				{ loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }) },
				{ assert },
			);
		}

		it("makes dependency and execution approval prompt even when the agent allows every permission", async () => {
			const plugin = await pluginFor(approvalSession(), allowing());
			const allow = (action: string, resource = "*"): PermissionRule => ({
				action,
				resource,
				effect: "allow",
			});
			const deny = (action: string, resource = "*"): PermissionRule => ({
				action,
				resource,
				effect: "deny",
			});
			const ask = (action: string): PermissionRule => ({ action, resource: "*", effect: "ask" });
			const agents: Record<string, PermissionRule[]> = {
				build: [allow("*")],
				plan: [allow("*"), deny("*")],
				userChoice: [allow("*"), allow("notebooks_trust"), deny("notebooks_execute")],
				userWildcard: [allow("*"), allow("notebooks_*")],
				scoped: [allow("*"), allow("notebooks_execute", `ses_x:${NOTEBOOK_ID}`)],
				deniedThenScoped: [deny("*"), allow("notebooks_execute", "a")],
			};
			const updated: string[] = [];
			expect(plugin.kilo.agentTransforms).toHaveLength(1);
			plugin.kilo.agentTransforms[0]!({
				list: () => Object.keys(agents).map((id) => ({ id })),
				update: (id, update) => {
					updated.push(id);
					update({ permissions: agents[id]! });
				},
			});

			expect(updated).toEqual(Object.keys(agents));
			// Kilo v2 evaluates the last matching rule, so the trailing asks override the catch-all.
			expect(agents.build).toEqual([allow("*"), ask("notebooks_trust"), ask("notebooks_execute")]);
			// An agent that denies everything is not loosened to ask.
			expect(agents.plan).toEqual([allow("*"), deny("*")]);
			expect(agents.userChoice).toEqual([
				allow("*"),
				allow("notebooks_trust"),
				deny("notebooks_execute"),
			]);
			expect(agents.userWildcard).toEqual([allow("*"), allow("notebooks_*")]);
			// Resource-scoped user rules keep winning for their resources; the ask covers the rest.
			expect(agents.scoped).toEqual([
				allow("*"),
				ask("notebooks_execute"),
				allow("notebooks_execute", `ses_x:${NOTEBOOK_ID}`),
				ask("notebooks_trust"),
			]);
			expect(agents.deniedThenScoped).toEqual([deny("*"), allow("notebooks_execute", "a")]);
		});

		it("adds default-approved packages to a trusted notebook without asking", async () => {
			const session = approvalSession();
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["pandas>=2", "conda-forge::numpy"] },
				toolContext(),
			);

			expect(assert).not.toHaveBeenCalled();
			expect(session.addDependencies).toHaveBeenCalledWith(
				["pandas>=2", "conda-forge::numpy"],
				undefined,
			);
		});

		it("asks before adding a new package and allows remembering it per package", async () => {
			const session = approvalSession();
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{
					notebook_id: NOTEBOOK_ID,
					action: "add",
					packages: ["requests>=2"],
					package_manager: "uv",
				},
				toolContext(),
			);

			expect(assert).toHaveBeenCalledWith(
				permissionRequest({
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
				}),
			);
			expect(session.addDependencies).toHaveBeenCalledWith(["requests>=2"], {
				packageManager: "uv",
			});
		});

		it("lists the notebook's unapproved dependencies that an add would also approve", async () => {
			const session = approvalSession(UNTRUSTED_STATUS);
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["requests"] },
				toolContext(),
			);

			expect(assert.mock.calls[0]?.[0]).toMatchObject({
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
				const assert = allowing();
				await (
					await pluginFor(approvalSession(status), assert)
				).tool.notebooks_dependencies.execute({ notebook_id: NOTEBOOK_ID, ...args }, toolContext());
				return assert.mock.calls[0]?.[0].metadata["title"];
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
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["numppy>=1"] },
				toolContext(),
			);

			expect(assert.mock.calls[0]?.[0]).toMatchObject({
				resources: ["numppy (similar to numpy)"],
				save: [],
				metadata: {
					typosquat_warnings: [{ package: "numppy", similar_to: "numpy", distance: 1 }],
				},
			});
		});

		it("installs nothing when the user rejects an add or run_cell dependency", async () => {
			const session = approvalSession();
			const plugin = await pluginFor(session, rejecting());

			await expect(
				plugin.tool.notebooks_dependencies.execute(
					{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["reqeusts"] },
					toolContext(),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				plugin.tool.notebooks_run_cell.execute(
					{ notebook_id: NOTEBOOK_ID, code: "import requests", dependencies: ["requests"] },
					toolContext(),
				),
			).rejects.toThrow(/rejected/);

			expect(session.addDependencies).not.toHaveBeenCalled();
			expect(session.syncEnvironment).not.toHaveBeenCalled();
			expect(session.runCell).not.toHaveBeenCalled();
		});

		it("aborts when the dependencies change while the prompt is open", async () => {
			const session = approvalSession(UNTRUSTED_STATUS, "deps-2");

			await expect(
				(await pluginFor(session)).tool.notebooks_dependencies.execute(
					{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
					toolContext(),
				),
			).rejects.toThrow(/changed while approval was pending/);
			expect(session.approveTrust).not.toHaveBeenCalled();
		});

		it("asks before a removal that would approve the remaining unapproved dependencies", async () => {
			const session = approvalSession({
				...UNTRUSTED_STATUS,
				uv: { dependencies: ["evil-pkg", "other-pkg", "numpy"] },
			});
			const assert = allowing();
			const plugin = await pluginFor(session, assert);

			await plugin.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg"] },
				toolContext(),
			);
			await plugin.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg", "other-pkg"] },
				toolContext(),
			);

			expect(assert).toHaveBeenCalledOnce();
			expect(assert.mock.calls[0]?.[0]).toMatchObject({ resources: ["uv: other-pkg"], save: [] });
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
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				toolContext(),
			);

			expect(assert).toHaveBeenCalledWith(
				permissionRequest({
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
				}),
			);
			expect(session.approveTrust).toHaveBeenCalledWith(undefined);
		});

		it("never offers to remember a package the notebook already declares unapproved", async () => {
			const session = approvalSession(UNTRUSTED_STATUS);
			const assert = allowing();
			const plugin = await pluginFor(session, assert);

			await plugin.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["evil-pkg"] },
				toolContext(),
			);
			await plugin.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add", packages: ["evil-pkg>=1"] },
				toolContext(),
			);

			// The exact spec is listed once, as the notebook's own dependency.
			expect(assert.mock.calls[0]?.[0]).toMatchObject({ resources: ["uv: evil-pkg"], save: [] });
			// A different spec for the same package is shown but still not rememberable.
			expect(assert.mock.calls[1]?.[0]).toMatchObject({
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
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["evil-pkg"] },
				toolContext(),
			);

			expect(assert.mock.calls[0]?.[0]).toMatchObject({
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
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				toolContext(),
			);

			expect(assert.mock.calls[0]?.[0]).toMatchObject({ resources: ["conda channel: my-org"] });
			expect(session.approveTrust).toHaveBeenCalledOnce();
		});

		it("does not ask or approve when nothing needs approval", async () => {
			const session = approvalSession();
			const assert = allowing();

			const result = await (
				await pluginFor(session, assert)
			).tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "approve_trust" },
				toolContext(),
			);

			expect(assert).not.toHaveBeenCalled();
			expect(session.approveTrust).not.toHaveBeenCalled();
			expect(JSON.parse(text(result))).not.toHaveProperty("approval");
		});

		it("reports what needs approval in dependency status and diagnosis", async () => {
			const plugin = await pluginFor(approvalSession(UNTRUSTED_STATUS));

			const status = JSON.parse(
				text(
					await plugin.tool.notebooks_dependencies.execute(
						{ notebook_id: NOTEBOOK_ID, action: "status" },
						toolContext(),
					),
				),
			);
			const diagnosis = JSON.parse(
				text(
					await plugin.tool.notebooks_diagnose.execute({ notebook_id: NOTEBOOK_ID }, toolContext()),
				),
			);

			expect(status.approval).toEqual({ needs_approval: true, unapproved: ["uv: evil-pkg"] });
			expect(diagnosis.approval).toEqual({ needs_approval: true, unapproved: ["uv: evil-pkg"] });
			expect(diagnosis.summary).toMatch(/waiting for the user to approve.*uv: evil-pkg/);
			expect(diagnosis.summary).toMatch(/Review/);
		});

		it("explains a trust rejection instead of surfacing the daemon's message", async () => {
			const plugin = await pluginFor(approvalSession(UNTRUSTED_STATUS));

			await expect(
				plugin.tool.notebooks_execute.execute(
					{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1"] },
					toolContext(),
				),
			).rejects.toThrow(/need approval before.*uv: evil-pkg.*approve_trust/s);
		});
	});

	describe("execution approval", () => {
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

		async function pluginFor(
			session: ReturnType<typeof executionSession>,
			assert: ReturnType<typeof allowing> = allowing(),
		) {
			return bootPlugin(
				{ loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }) },
				{ assert },
			);
		}

		it("asks once, per notebook, before run_cell executes code", async () => {
			const session = executionSession();
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "print('hi')" },
				toolContext(),
			);

			expect(assert).toHaveBeenCalledExactlyOnceWith(
				permissionRequest({
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
				}),
			);
			expect(session.runCell).toHaveBeenCalledOnce();
		});

		it("asks to execute before asking about run_cell dependencies", async () => {
			const session = executionSession();
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "import requests", dependencies: ["requests"] },
				toolContext(),
			);

			expect(assert.mock.calls.map(([request]) => request.action)).toEqual([
				"notebooks_execute",
				"notebooks_trust",
			]);
		});

		it("changes nothing when the user rejects running code", async () => {
			const session = executionSession();
			const assert = rejecting();
			const plugin = await pluginFor(session, assert);

			await expect(
				plugin.tool.notebooks_run_cell.execute(
					{ notebook_id: NOTEBOOK_ID, code: "1", dependencies: ["requests"] },
					toolContext(),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				plugin.tool.notebooks_create_cell.execute(
					{ notebook_id: NOTEBOOK_ID, source: "1", and_run: true },
					toolContext(),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				plugin.tool.notebooks_execute.execute(
					{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-1"] },
					toolContext(),
				),
			).rejects.toThrow(/rejected/);
			await expect(
				plugin.tool.notebooks_kernel.execute(
					{ notebook_id: NOTEBOOK_ID, action: "restart" },
					toolContext(),
				),
			).rejects.toThrow(/rejected/);

			expect(assert).toHaveBeenCalledTimes(4);
			expect(assert.mock.calls.every(([request]) => request.action === "notebooks_execute")).toBe(
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
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "x = 1", and_run: true },
				toolContext(),
			);

			expect(assert).toHaveBeenCalledExactlyOnceWith(
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
			const assert = allowing();
			const plugin = await pluginFor(session, assert);

			await plugin.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "x = 1" },
				toolContext(),
			);
			await plugin.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "# t", cell_type: "markdown", and_run: true },
				toolContext(),
			);

			expect(assert).not.toHaveBeenCalled();
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
			const assert = allowing();

			await (
				await pluginFor(session, assert)
			).tool.notebooks_execute.execute(
				{ notebook_id: NOTEBOOK_ID, cell_ids: ["cell-3", "cell-1", "cell-2"] },
				toolContext(),
			);

			expect(assert).toHaveBeenCalledExactlyOnceWith(
				permissionRequest({
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
				}),
			);
			expect(session.executeCell).toHaveBeenCalledTimes(3);
		});

		it("titles an all-cells run and skips the prompt when there is nothing to run", async () => {
			const session = executionSession();
			const assert = allowing();
			const plugin = await pluginFor(session, assert);

			await plugin.tool.notebooks_execute.execute({ notebook_id: NOTEBOOK_ID }, toolContext());
			expect(assert.mock.calls[0]?.[0].metadata).toMatchObject({
				title: "Run all code cells?",
				cell_ids: ["cell-1"],
				cell_numbers: [2],
				all_cells: true,
			});

			session.listCells.mockResolvedValueOnce([]);
			await plugin.tool.notebooks_execute.execute({ notebook_id: NOTEBOOK_ID }, toolContext());
			expect(assert).toHaveBeenCalledOnce();
		});

		it("asks before restarting the kernel but not to interrupt or inspect it", async () => {
			const session = executionSession();
			const assert = allowing();
			const plugin = await pluginFor(session, assert);

			await plugin.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "status" },
				toolContext(),
			);
			await plugin.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "interrupt" },
				toolContext(),
			);
			expect(assert).not.toHaveBeenCalled();

			await plugin.tool.notebooks_kernel.execute(
				{ notebook_id: NOTEBOOK_ID, action: "restart" },
				toolContext(),
			);
			expect(assert).toHaveBeenCalledExactlyOnceWith(
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
		type BootedPlugin = Awaited<ReturnType<typeof pluginFor>>;
		type Context = ReturnType<typeof toolContext>;
		const executingCalls: [
			string,
			(plugin: BootedPlugin, notebookId: string, context: Context) => unknown,
		][] = [
			[
				"run_cell",
				(plugin, notebookId, context) =>
					plugin.tool.notebooks_run_cell.execute({ notebook_id: notebookId, code: "1" }, context),
			],
			[
				"create_cell with and_run",
				(plugin, notebookId, context) =>
					plugin.tool.notebooks_create_cell.execute(
						{ notebook_id: notebookId, source: "1", and_run: true },
						context,
					),
			],
			[
				"execute",
				(plugin, notebookId, context) =>
					plugin.tool.notebooks_execute.execute({ notebook_id: notebookId }, context),
			],
			[
				"kernel restart",
				(plugin, notebookId, context) =>
					plugin.tool.notebooks_kernel.execute(
						{ notebook_id: notebookId, action: "restart" },
						context,
					),
			],
		];

		it.each(executingCalls)(
			"scopes %s approval to one notebook in one Kilo session",
			async (_name, run) => {
				const assert = allowing();
				const plugin = await pluginFor(executionSession(), assert);
				const inSession = (sessionID: string) => toolContext({ sessionID });

				await run(plugin, NOTEBOOK_ID, inSession("kilo-session-1"));
				await run(plugin, NOTEBOOK_ID, inSession("kilo-session-2"));
				await run(plugin, OTHER_NOTEBOOK_ID, inSession("kilo-session-1"));

				expect(assert.mock.calls.map(([request]) => [request.resources, request.save])).toEqual([
					[[`kilo-session-1:${NOTEBOOK_ID}`], [`kilo-session-1:${NOTEBOOK_ID}`]],
					[[`kilo-session-2:${NOTEBOOK_ID}`], [`kilo-session-2:${NOTEBOOK_ID}`]],
					[[`kilo-session-1:${OTHER_NOTEBOOK_ID}`], [`kilo-session-1:${OTHER_NOTEBOOK_ID}`]],
				]);
				expect(assert.mock.calls.map(([request]) => request.metadata.notebook_id)).toEqual([
					NOTEBOOK_ID,
					NOTEBOOK_ID,
					OTHER_NOTEBOOK_ID,
				]);
			},
		);

		it("refuses cancelled calls and placeholder ids before asking", async () => {
			const session = executionSession();
			const assert = allowing();
			const plugin = await pluginFor(session, assert);
			const aborted = new AbortController();
			aborted.abort();
			const cancelled = toolContext({ signal: aborted.signal });

			await expect(
				plugin.tool.notebooks_run_cell.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, cancelled),
			).rejects.toThrow(/cancelled/);
			await expect(
				plugin.tool.notebooks_create_cell.execute(
					{ notebook_id: NOTEBOOK_ID, source: "1", and_run: true },
					cancelled,
				),
			).rejects.toThrow(/cancelled/);
			await expect(
				plugin.tool.notebooks_run_cell.execute({ notebook_id: "?", code: "1" }, toolContext()),
			).rejects.toThrow(/notebook_id must be a notebook UUID/);

			expect(assert).not.toHaveBeenCalled();
		});
	});

	it("saves a notebook to a path inside the Kilo workspace", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		const result = await plugin.tool.notebooks_save.execute(
			{ notebook_id: NOTEBOOK_ID, path: "reports/analysis.ipynb" },
			toolContext(),
		);

		const savedPath = path.resolve("/projects/demo/reports/analysis.ipynb");
		expect(session.saveNotebook).toHaveBeenCalledWith(savedPath);
		expect(plugin.kilo.assert).not.toHaveBeenCalled();
		expect(result).toEqual({
			content: [{ type: "text", text: savedPath }],
			metadata: { title: "Notebook saved", notebook_id: NOTEBOOK_ID, path: savedPath },
		});
	});

	it("asks before saving a notebook outside the Kilo workspace", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});

		await plugin.tool.notebooks_save.execute(
			{ notebook_id: NOTEBOOK_ID, path: "/exports/analysis.ipynb" },
			toolContext(),
		);

		const externalPath = path.resolve("/exports/analysis.ipynb");
		const externalDirectory = path.join(path.dirname(externalPath), "*").replaceAll("\\", "/");
		expect(plugin.kilo.assert).toHaveBeenCalledExactlyOnceWith(
			permissionRequest({
				action: "external_directory",
				resources: [externalDirectory],
				save: [externalDirectory],
				metadata: { notebook_id: NOTEBOOK_ID, path: externalPath },
			}),
		);
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({
				openNotebook: vi.fn(async () => session),
				getExecutionResult: vi.fn(),
			}),
		});
		await plugin.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "1 + 1" },
			toolContext(),
		);

		await plugin.emit({ type: "session.deleted", data: { sessionID: "kilo-session-1" } });

		expect(session.close).toHaveBeenCalledOnce();
	});

	it("rejects a runtimed module that does not export openNotebook", async () => {
		await expect(bootPlugin({ loadRuntimedNode: () => ({}) })).rejects.toThrow(
			/does not export openNotebook/,
		);
		await expect(bootPlugin({ loadRuntimedNode: () => null })).rejects.toThrow(
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		});

		await expect(
			plugin.tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "1" },
				toolContext(),
			),
		).rejects.toThrow(/daemon unavailable/);
		await expect(
			plugin.tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "1" },
				toolContext(),
			),
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});
		await plugin.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "1" },
			toolContext({ sessionID: "kilo-session-1" }),
		);
		await plugin.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "2" },
			toolContext({ sessionID: "kilo-session-2" }),
		);

		await plugin.emit({ type: "session.deleted", data: { sessionID: "kilo-session-1" } });
		expect(session.close).not.toHaveBeenCalled();

		await plugin.emit({ type: "file.edited" });
		await plugin.emit({ type: "session.deleted", data: { sessionID: "kilo-session-2" } });
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		const result = await plugin.tool.notebooks_run_cell.execute(
			{ notebook_id: NOTEBOOK_ID, code: "raise ValueError('bad')" },
			toolContext(),
		);

		expect(text(result)).toContain("[stderr] warn");
		expect(text(result)).toContain("Traceback (most recent call last):");
		expect(text(result)).toContain("[update_display_data output]");
	});

	it("refuses cancelled run and create calls and missing cells", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			getCell: vi.fn(async () => null),
			createCell: vi.fn(),
			runCell: vi.fn(),
			close: vi.fn(async () => undefined),
		};
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});
		const aborted = new AbortController();
		aborted.abort();

		await expect(
			plugin.tool.notebooks_run_cell.execute(
				{ notebook_id: NOTEBOOK_ID, code: "1" },
				toolContext({ signal: aborted.signal }),
			),
		).rejects.toThrow(/cancelled/);
		await expect(
			plugin.tool.notebooks_create_cell.execute(
				{ notebook_id: NOTEBOOK_ID, source: "1" },
				toolContext({ signal: aborted.signal }),
			),
		).rejects.toThrow(/cancelled/);
		await expect(
			plugin.tool.notebooks_read.execute(
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		const result = await plugin.tool.notebooks_create_cell.execute(
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
		expect(JSON.parse(text(result))).toEqual({
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		const result = await plugin.tool.notebooks_execute.execute(
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
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		await expect(
			plugin.tool.notebooks_dependencies.execute(
				{ notebook_id: NOTEBOOK_ID, action: "add" },
				toolContext(),
			),
		).rejects.toThrow(/packages is required/);
		await plugin.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "remove", packages: ["pandas"] },
			toolContext(),
		);
		await plugin.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "sync" },
			toolContext(),
		);
		const status = await plugin.tool.notebooks_dependencies.execute(
			{ notebook_id: NOTEBOOK_ID, action: "status" },
			toolContext(),
		);

		expect(session.removeDependencies).toHaveBeenCalledWith(["pandas"], undefined);
		expect(session.syncEnvironment).toHaveBeenCalledTimes(2);
		expect(JSON.parse(text(status)).action).toBe("status");
	});

	it("interrupts the kernel and saves to the notebook's current path", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			interruptKernel: vi.fn(async () => undefined),
			getRuntimeStatus: vi.fn(async () => ({ status: "idle" })),
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const plugin = await bootPlugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }),
		});

		await plugin.tool.notebooks_kernel.execute(
			{ notebook_id: NOTEBOOK_ID, action: "interrupt" },
			toolContext(),
		);
		const saved = await plugin.tool.notebooks_save.execute(
			{ notebook_id: NOTEBOOK_ID },
			toolContext(),
		);
		await expect(
			plugin.tool.notebooks_save.execute(
				{ notebook_id: NOTEBOOK_ID, path: "notes.txt" },
				toolContext(),
			),
		).rejects.toThrow(/must end in \.ipynb/);

		expect(session.interruptKernel).toHaveBeenCalledOnce();
		expect(session.saveNotebook).toHaveBeenCalledWith();
		expect(text(saved)).toBe("Saved to the notebook's current path.");
	});
});

describe("notebook_id contract", () => {
	async function pluginWithSpy(directory = DIRECTORY) {
		const openNotebook = vi.fn();
		const plugin = await bootPlugin({ loadRuntimedNode: () => ({ openNotebook }) }, { directory });
		const tool = (name: NotebookToolName) => plugin.tool[name];
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
				tool(toolName as NotebookToolName).execute({ notebook_id: "?", ...args }, toolContext()),
			).rejects.toThrow(/notebook_id must be a notebook UUID.*desktop_notebook_list_open/);
			expect(openNotebook).not.toHaveBeenCalled();
		},
	);

	it("redirects a workspace notebook name to desktop_notebook_open_file without opening it", async () => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "notebook-id-workspace-"));
		await mkdir(path.join(workspace, "reports"));
		await writeFile(path.join(workspace, "reports", "q3.ipynb"), "{}");
		const resolved = await realpath(path.join(workspace, "reports", "q3.ipynb"));
		const { openNotebook, tool } = await pluginWithSpy(workspace);

		const attempt = tool("notebooks_read").execute(
			{ notebook_id: "reports/q3.ipynb" },
			toolContext(),
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
		const { openNotebook, tool } = await pluginWithSpy(workspace);

		for (const notebookId of [outside, "linked.ipynb", "../private.ipynb"]) {
			const attempt = tool("notebooks_read").execute({ notebook_id: notebookId }, toolContext());
			await expect(attempt).rejects.toThrow(
				`notebook_id must be a notebook UUID from desktop_notebook_list_open or desktop_notebook_open_file; got ${JSON.stringify(notebookId)}.`,
			);
		}
		expect(openNotebook).not.toHaveBeenCalled();
	});
});

describe("Kilo v2 plugin API", () => {
	const TOOL_NAMES = [
		"notebooks_create_cell",
		"notebooks_dependencies",
		"notebooks_diagnose",
		"notebooks_edit_cells",
		"notebooks_execute",
		"notebooks_kernel",
		"notebooks_read",
		"notebooks_run_cell",
		"notebooks_save",
	];

	function runCellSession() {
		return {
			notebookId: NOTEBOOK_ID,
			runCell: vi.fn(async () => ({
				cellId: "cell-7",
				executionId: "execution-7",
				executionCount: 7,
				status: "done",
				success: true,
				outputs: [{ outputType: "stream", name: "stdout", text: "answer: 42\n" }],
			})),
			listCells: vi.fn(async () => []),
			getExecutionView: vi.fn(() => ({ cell_execution_ids: {}, executions: {}, queue: null })),
			close: vi.fn(async () => undefined),
		};
	}

	async function boot(session: unknown) {
		return bootPlugin({ loadRuntimedNode: () => ({ openNotebook: vi.fn(async () => session) }) });
	}

	it("exports a v2 module with the plugin id and a setup function", async () => {
		const module = (await import("./index")).default;
		expect(module.id).toBe("anaconda-notebooks");
		expect(module.setup).toBeTypeOf("function");
	});

	it("registers every notebook tool individually with a Standard Schema input", async () => {
		const { kilo } = await boot({});

		expect([...kilo.tools.keys()].sort()).toEqual(TOOL_NAMES);
		for (const tool of kilo.tools.values()) {
			expect(tool.options).toEqual({ codemode: false });
			expect(tool.input["~standard"].vendor).toBe("zod");
			expect(jsonSchema(tool)).toMatchObject({
				type: "object",
				required: expect.arrayContaining(["notebook_id"]),
			});
		}
		const input = jsonSchema(kilo.tools.get("notebooks_run_cell")!) as {
			properties: Record<string, Record<string, unknown>>;
			required: string[];
			additionalProperties?: unknown;
		};
		expect(input.required).toEqual(["notebook_id", "code"]);
		expect(input.additionalProperties).toBeUndefined();
		expect(input.properties.timeout_secs).toMatchObject({ type: "number", maximum: 3600 });
	});

	it("leaves the uuid format out of notebook_id so malformed ids reach the redirect", async () => {
		const { kilo } = await boot({});

		for (const tool of kilo.tools.values()) {
			const { properties } = jsonSchema(tool) as {
				properties: Record<string, Record<string, unknown>>;
			};
			expect(properties.notebook_id).toEqual({
				type: "string",
				description: expect.stringMatching(/^Notebook UUID from desktop_notebook_list_open/),
			});
		}
		await expect(
			validated(kilo.tools.get("notebooks_read")!, { notebook_id: "q3.ipynb" }),
		).resolves.toEqual({ notebook_id: "q3.ipynb" });
	});

	it("rejects edit operations with misspelled keys instead of dropping them", async () => {
		const { kilo } = await boot({});
		const editCells = kilo.tools.get("notebooks_edit_cells")!;

		for (const branch of editOperationSchemas(jsonSchema(editCells))) {
			expect(branch.additionalProperties).toBe(false);
		}
		await expect(
			validated(editCells, {
				notebook_id: NOTEBOOK_ID,
				operations: [{ action: "update", cell_id: "cell-1", sourc: "x = 1" }],
			}),
		).rejects.toThrow(/invalid input/);
	});

	it("asks through permission.assert with the call as its source", async () => {
		const { kilo } = await boot(runCellSession());

		await kilo.tools
			.get("notebooks_run_cell")!
			.execute(
				{ notebook_id: NOTEBOOK_ID, code: "print(42)" },
				toolContext({ id: "call-7", messageID: "message-7" }),
			);

		const scope = `kilo-session-1:${NOTEBOOK_ID}`;
		expect(kilo.assert).toHaveBeenCalledExactlyOnceWith({
			sessionID: "kilo-session-1",
			agent: "build",
			action: "notebooks_execute",
			resources: [scope],
			save: [scope],
			metadata: expect.objectContaining({
				toolName: "Run notebook code",
				notebook_id: NOTEBOOK_ID,
				action: "run",
				code: "print(42)",
			}),
			source: { type: "tool", messageID: "message-7", id: "call-7" },
		});
	});

	it("propagates a rejected assert without running the code", async () => {
		const session = runCellSession();
		const { kilo } = await boot(session);
		const declined = new Error("The user rejected permission to use this specific tool call.");
		kilo.assert.mockRejectedValueOnce(declined);

		await expect(
			kilo.tools
				.get("notebooks_run_cell")!
				.execute({ notebook_id: NOTEBOOK_ID, code: "print(42)" }, toolContext()),
		).rejects.toBe(declined);
		expect(session.runCell).not.toHaveBeenCalled();
	});

	it("only reads the call signal in tools that stop cooperatively", async () => {
		const { kilo } = await boot(runCellSession());
		const signalRead = vi.fn();
		const context = toolContext();
		Object.defineProperty(context, "signal", {
			get: () => {
				signalRead();
				return new AbortController().signal;
			},
		});

		await kilo.tools.get("notebooks_read")!.execute({ notebook_id: NOTEBOOK_ID }, context);
		expect(signalRead).not.toHaveBeenCalled();

		await kilo.tools
			.get("notebooks_run_cell")!
			.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, context);
		expect(signalRead).toHaveBeenCalled();
	});

	it("subscribes to session.deleted and releases that chat's notebook peers", async () => {
		const session = runCellSession();
		const { kilo, tool } = await boot(session);
		await tool.notebooks_run_cell.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, toolContext());

		expect(kilo.subscriptions.map((subscription) => subscription.types)).toEqual([
			["session.deleted"],
		]);
		await kilo.channel.emit({ type: "session.deleted", data: { sessionID: "other-session" } });
		expect(session.close).not.toHaveBeenCalled();
		await kilo.channel.emit({ type: "session.deleted", data: { sessionID: "kilo-session-1" } });
		expect(session.close).toHaveBeenCalledOnce();
	});

	it("stops the event subscription and closes open peers on cleanup", async () => {
		const session = runCellSession();
		const { kilo, tool, cleanup } = await boot(session);
		await tool.notebooks_run_cell.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, toolContext());

		await cleanup();

		expect(kilo.subscriptions[0]?.signal?.aborted).toBe(true);
		expect(kilo.channel.ended).toBe(true);
		expect(session.close).toHaveBeenCalledOnce();
	});

	it("does not fail setup when the event subscription fails", async () => {
		const kilo = fakeKilo();
		kilo.ctx.event.subscribe = () => ({
			[Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("stream closed")) }),
		});

		await expect(
			createNteractKiloPlugin({ loadRuntimedNode: () => ({ openNotebook: vi.fn() }) }).setup(
				kilo.ctx,
			),
		).resolves.toBeTypeOf("function");
	});

	it("requireNotebookPrompts leaves agents without any rules asking", () => {
		const permissions: PermissionRule[] = [];
		requireNotebookPrompts(permissions);
		expect(permissions).toEqual([
			{ action: "notebooks_trust", resource: "*", effect: "ask" },
			{ action: "notebooks_execute", resource: "*", effect: "ask" },
		]);
	});
});
