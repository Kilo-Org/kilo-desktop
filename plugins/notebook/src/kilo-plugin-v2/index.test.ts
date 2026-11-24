import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	createNteractKiloPlugin,
	inputSchema,
	requireNotebookPrompts,
	toV2Tool,
	type PermissionRule,
	type PluginContext,
	type V2Tool,
} from "./index";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";
const DIRECTORY = "/projects/demo";

/**
 * The tool scenarios below are shared with the v1 plugin's tests and written
 * against v1's tool context (`ask`, `abort`, `worktree`) and result shape
 * (`title`, `output`, `attachments`). `v2Plugin` boots the real v2 module
 * against a fake Kilo v2 plugin context and bridges each call: the v1 context
 * becomes a v2 tool context, the plugin's `permission.assert` is forwarded to
 * the call's `ask`, and the v2 result is read back into v1's shape. The
 * "Kilo v2 plugin boundary" tests pin the exact v2 shapes.
 */
function toolContext(overrides: Partial<{ abort: AbortSignal; worktree: string }> = {}) {
	return {
		sessionID: "kilo-session-1",
		messageID: "message-1",
		agent: "build",
		directory: DIRECTORY,
		worktree: overrides.worktree ?? DIRECTORY,
		abort: overrides.abort ?? new AbortController().signal,
		metadata: vi.fn(),
		ask: vi.fn(async (_request: unknown) => undefined),
	};
}

type V1Context = ReturnType<typeof toolContext>;
type AssertInput = Parameters<PluginContext["permission"]["assert"]>[0];
type AgentTransform = Parameters<PluginContext["agent"]["transform"]>[0];
type V2Event = { type: string; data?: unknown };
type V2Content =
	| { type: "text"; text: string }
	| { type: "file"; uri: string; mime: string; name?: string };

/**
 * A pull-based event stream: `emit` resolves once the plugin asks for the next
 * event, i.e. after it has finished handling this one.
 */
function eventChannel() {
	const pending: Array<{ event: V2Event; handled: () => void }> = [];
	let waiter: ((result: IteratorResult<V2Event>) => void) | undefined;
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
		emit(event: V2Event): Promise<void> {
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
		iterable(signal?: AbortSignal): AsyncIterable<V2Event> {
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
						return new Promise<IteratorResult<V2Event>>((resolve) => (waiter = resolve));
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
function fakeKilo(directory = DIRECTORY) {
	const tools = new Map<string, V2Tool>();
	const agentTransforms: AgentTransform[] = [];
	const subscriptions: Array<{ types: string[]; signal?: AbortSignal }> = [];
	const channel = eventChannel();
	const asks = new Map<string, (request: unknown) => Promise<unknown>>();
	const assert = vi.fn(async (input: AssertInput) => {
		const ask = asks.get(input.source.id);
		await ask?.({
			permission: input.action,
			patterns: input.resources,
			always: input.save,
			metadata: input.metadata,
		});
	});
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
	return { ctx, tools, agentTransforms, subscriptions, channel, asks, assert };
}

type V1Result = {
	title?: string;
	output: string;
	metadata: Record<string, unknown>;
	attachments?: Array<{ type: "file"; mime: string; url: string; filename?: string }>;
};

function fromV2Result(result: Awaited<ReturnType<V2Tool["execute"]>>): V1Result {
	const [text, ...files] = result.content as V2Content[];
	if (text?.type !== "text") throw new Error("v2 result must lead with the text output");
	const { title, ...metadata } = result.metadata ?? {};
	return {
		...(typeof title === "string" ? { title } : {}),
		output: text.text,
		metadata,
		...(files.length
			? {
					attachments: files.map((file) => {
						if (file.type !== "file") throw new Error("only the first content part is text");
						return {
							type: "file" as const,
							mime: file.mime,
							url: file.uri,
							...(file.name ? { filename: file.name } : {}),
						};
					}),
				}
			: {}),
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

let callCount = 0;

/** Boots the v2 plugin and exposes its tools with v1's calling convention. */
function v2Plugin(
	dependencies: Parameters<typeof createNteractKiloPlugin>[0],
	options: { directory?: string | undefined } = {},
) {
	return async () => {
		const kilo = fakeKilo(options.directory);
		const cleanup = await createNteractKiloPlugin(dependencies).setup(kilo.ctx);
		const call = (tool: V2Tool) => ({
			description: tool.description,
			input: tool.input,
			async execute(args: unknown, context: V1Context): Promise<V1Result> {
				if (context.worktree !== kilo.ctx.location.directory) {
					throw new Error(`test booted the plugin at ${kilo.ctx.location.directory}`);
				}
				const id = `call-${++callCount}`;
				kilo.asks.set(id, context.ask);
				try {
					return fromV2Result(
						await tool.execute(args, {
							sessionID: context.sessionID,
							agent: context.agent,
							messageID: context.messageID,
							id,
							signal: context.abort,
							progress: async (metadata) => context.metadata(metadata),
						}),
					);
				} finally {
					kilo.asks.delete(id);
				}
			},
		});
		const tool = Object.fromEntries(
			[...kilo.tools].map(([name, value]) => [name, call(value)]),
		) as Record<
			| "notebooks_create_cell"
			| "notebooks_dependencies"
			| "notebooks_diagnose"
			| "notebooks_edit_cells"
			| "notebooks_execute"
			| "notebooks_kernel"
			| "notebooks_read"
			| "notebooks_run_cell"
			| "notebooks_save",
			ReturnType<typeof call>
		>;
		return {
			tool,
			kilo,
			cleanup,
			event: async ({
				event,
			}: {
				event: { type: string; properties?: Record<string, unknown> };
			}) => {
				if (kilo.subscriptions.some((subscription) => subscription.types.includes(event.type))) {
					await kilo.channel.emit({ type: event.type, data: event.properties });
				}
			},
		};
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
		const hooks = await v2Plugin({
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
		const plugin = v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const operation = editOperationSchemas(hooks.tool.notebooks_edit_cells.input);
		expect(operation.map((branch) => branch.properties.action.const)).toEqual([
			"update",
			"delete",
			"move",
		]);
	});

	it("rejects edit operations with misspelled keys instead of dropping them", async () => {
		const hooks = await v2Plugin({
			loadRuntimedNode: () => ({ openNotebook: vi.fn() }),
		})();

		// Advertised to the model; Kilo v2's validator ignores additionalProperties, so the
		// next test's in-tool guard is what catches a misspelled `source`.
		for (const branch of editOperationSchemas(hooks.tool.notebooks_edit_cells.input)) {
			expect(branch.additionalProperties).toBe(false);
		}
	});

	it("refuses updates that change nothing before applying any operation", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			setCell: vi.fn(async () => true),
			deleteCell: vi.fn(async () => true),
			close: vi.fn(async () => undefined),
		};
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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

	describe("notebooks_diagnose", () => {
		const CONDA_ERROR =
			"Failed to create conda env 'notebook-test' from environment.yml: Failed to fetch package metadata: HTTP status client error (403 Forbidden)";

		function diagnoseHooks(session: Record<string, unknown>) {
			return v2Plugin({
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
			return v2Plugin({
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
			expect(hooks.kilo.agentTransforms).toHaveLength(1);
			hooks.kilo.agentTransforms[0]!({
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
			return v2Plugin({
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

	it("saves a notebook to a path inside the Kilo workspace", async () => {
		const session = {
			notebookId: NOTEBOOK_ID,
			saveNotebook: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		await expect(v2Plugin({ loadRuntimedNode: () => ({}) })()).rejects.toThrow(
			/does not export openNotebook/,
		);
		await expect(v2Plugin({ loadRuntimedNode: () => null })()).rejects.toThrow(
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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
		const hooks = await v2Plugin({
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

	async function pluginWithSpy(directory?: string) {
		const openNotebook = vi.fn();
		const hooks = await v2Plugin({ loadRuntimedNode: () => ({ openNotebook }) }, { directory })();
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
		const { openNotebook, tool } = await pluginWithSpy(workspace);

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
		const { openNotebook, tool } = await pluginWithSpy(workspace);

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

describe("Kilo v2 plugin boundary", () => {
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

	function v2Context(overrides: Partial<Parameters<V2Tool["execute"]>[1]> = {}) {
		return {
			sessionID: "kilo-session-1",
			agent: "build",
			messageID: "message-1",
			id: "call-7",
			signal: new AbortController().signal,
			progress: vi.fn(async (_metadata: Record<string, unknown>) => undefined),
			...overrides,
		};
	}

	function runCellSession() {
		return {
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
						dataJson: JSON.stringify({ "image/png": { type: "binary", value: "AAAA" } }),
					},
				],
			})),
			close: vi.fn(async () => undefined),
		};
	}

	async function boot(session: unknown) {
		const kilo = fakeKilo();
		const openNotebook = vi.fn(async () => session);
		const cleanup = await createNteractKiloPlugin({
			loadRuntimedNode: () => ({ openNotebook }),
		}).setup(kilo.ctx);
		return { kilo, cleanup, openNotebook };
	}

	it("exports a v2 module with the plugin id and a setup function", async () => {
		const module = (await import("./index")).default;
		expect(module.id).toBe("anaconda-notebooks");
		expect(module.setup).toBeTypeOf("function");
	});

	it("registers every notebook tool individually with a JSON Schema input", async () => {
		const { kilo } = await boot({});

		expect([...kilo.tools.keys()].sort()).toEqual(TOOL_NAMES);
		for (const tool of kilo.tools.values()) {
			expect(tool.options).toEqual({ codemode: false });
			expect(tool.input).not.toHaveProperty("$schema");
			expect(tool.input).toMatchObject({
				type: "object",
				required: expect.arrayContaining(["notebook_id"]),
			});
		}
		const input = kilo.tools.get("notebooks_run_cell")!.input as {
			properties: Record<string, Record<string, unknown>>;
			required: string[];
			additionalProperties?: unknown;
		};
		expect(input.required).toEqual(["notebook_id", "code"]);
		// Unknown top-level keys are stripped by zod in v1; v2 must not start rejecting them.
		expect(input.additionalProperties).toBeUndefined();
		expect(input.properties.notebook_id).toEqual({
			type: "string",
			description: expect.stringMatching(/^Notebook UUID from desktop_notebook_list_open/),
		});
		expect(input.properties.timeout_secs).toMatchObject({ type: "number", maximum: 3600 });
	});

	it("keeps zod's uuid check out of the schema so malformed ids reach the redirect", () => {
		const schema = inputSchema({
			notebook_id: z.string().uuid().describe("Notebook UUID."),
			cell_id: z.string().uuid(),
		});

		expect(schema).toEqual({
			type: "object",
			properties: {
				notebook_id: { type: "string", description: "Notebook UUID." },
				cell_id: expect.objectContaining({ format: "uuid" }),
			},
			required: ["notebook_id", "cell_id"],
		});
	});

	it("maps a tool result to text and file content with the title in metadata", async () => {
		const { kilo } = await boot(runCellSession());

		const result = await kilo.tools
			.get("notebooks_run_cell")!
			.execute({ notebook_id: NOTEBOOK_ID, code: "print(42)" }, v2Context());

		expect(result).toEqual({
			content: [
				{ type: "text", text: "cell cell-7 [7] done\nanswer: 42" },
				{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png" },
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
	});

	it("asks through permission.assert with the call as its source", async () => {
		const session = runCellSession();
		const { kilo } = await boot(session);

		await kilo.tools
			.get("notebooks_run_cell")!
			.execute({ notebook_id: NOTEBOOK_ID, code: "print(42)" }, v2Context());

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
			source: { type: "tool", messageID: "message-1", id: "call-7" },
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
				.execute({ notebook_id: NOTEBOOK_ID, code: "print(42)" }, v2Context()),
		).rejects.toBe(declined);
		expect(session.runCell).not.toHaveBeenCalled();
	});

	it("bridges metadata to progress, abort to the call signal, and the location to the workspace", async () => {
		const kilo = fakeKilo("/projects/located");
		const seen: Record<string, unknown> = {};
		const tool = toV2Tool(
			"probe",
			{
				description: "Probe",
				args: {},
				async execute(_args, context) {
					seen.directory = context.directory;
					seen.worktree = context.worktree;
					seen.aborted = context.abort.aborted;
					context.metadata({ title: "Working", metadata: { step: 1 } });
					return {
						output: "done",
						attachments: [
							{ type: "file", mime: "text/csv", url: "file:///tmp/a.csv", filename: "a.csv" },
						],
					};
				},
			},
			kilo.ctx,
		);
		const controller = new AbortController();
		controller.abort();
		const context = v2Context({ signal: controller.signal });

		const result = await tool.execute({}, context);

		expect(seen).toEqual({
			directory: "/projects/located",
			worktree: "/projects/located",
			aborted: true,
		});
		expect(context.progress).toHaveBeenCalledWith({ step: 1, title: "Working" });
		expect(result).toEqual({
			content: [
				{ type: "text", text: "done" },
				{ type: "file", uri: "file:///tmp/a.csv", mime: "text/csv", name: "a.csv" },
			],
			metadata: {},
		});
	});

	it("subscribes to session.deleted and releases that chat's notebook peers", async () => {
		const session = runCellSession();
		const { kilo } = await boot(session);
		await kilo.tools
			.get("notebooks_run_cell")!
			.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, v2Context());

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
		const { kilo, cleanup } = await boot(session);
		await kilo.tools
			.get("notebooks_run_cell")!
			.execute({ notebook_id: NOTEBOOK_ID, code: "1" }, v2Context());

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
