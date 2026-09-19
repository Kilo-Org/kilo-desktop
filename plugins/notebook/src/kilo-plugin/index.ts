import { createRequire } from "node:module";
import path from "node:path";

import { z } from "zod";

import type { CellResult, CellSnapshot, ExecutionView, Session } from "@runtimed/node";

type ToolAttachment = {
	type: "file";
	mime: string;
	url: string;
	filename?: string;
};

type ToolContext = {
	sessionID: string;
	messageID: string;
	agent: string;
	directory: string;
	worktree: string;
	abort: AbortSignal;
	metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
	ask(input: {
		permission: string;
		patterns: string[];
		always: string[];
		metadata: Record<string, unknown>;
	}): Promise<void>;
};

type ToolResult = {
	title?: string;
	output: string;
	metadata?: Record<string, unknown>;
	attachments?: ToolAttachment[];
};

type ToolDefinition<TArgs> = {
	description: string;
	args: z.ZodRawShape;
	execute(args: TArgs, context: ToolContext): Promise<ToolResult>;
};

type RuntimedNode = {
	openNotebook(
		notebookId: string,
		options?: { socketPath?: string; peerLabel?: string; description?: string },
	): Promise<Session>;
	getExecutionResult?(executionId: string): Promise<CellResult>;
};

type PluginDependencies = {
	loadRuntimedNode?: () => unknown;
};

const NOTEBOOK_ID = z.string().uuid().describe("Notebook id returned by the notebook panel tools.");
const NOTEBOOK_PEER_LABEL = "Kilo Desktop";

function defaultLoadRuntimedNode(): unknown {
	const require = createRequire(import.meta.url);
	const override = process.env.NTERACT_RUNTIMED_NODE_PATH?.trim();
	return require(override || "@runtimed/node");
}

function requireRuntimedNode(value: unknown): RuntimedNode {
	if (!value || typeof value !== "object") {
		throw new Error("@runtimed/node did not export a module object.");
	}
	const module = value as Record<string, unknown>;
	if (typeof module.openNotebook !== "function") {
		throw new Error("@runtimed/node does not export openNotebook().");
	}
	return value as RuntimedNode;
}

/**
 * Owns native notebook peers for one Kilo workspace plugin instance. Concurrent
 * opens coalesce, and failed opens leave no stale cache entry. Kilo session
 * ownership is tracked separately so session deletion can release only peers
 * that are no longer referenced by another chat.
 */
class NotebookSessionRegistry {
	readonly #runtimed: RuntimedNode;
	readonly #sessions = new Map<string, Promise<Session>>();
	readonly #notebooksByKiloSession = new Map<string, Set<string>>();

	constructor(runtimed: RuntimedNode) {
		this.#runtimed = runtimed;
	}

	open(notebookId: string, kiloSessionId: string): Promise<Session> {
		const owned = this.#notebooksByKiloSession.get(kiloSessionId) ?? new Set<string>();
		owned.add(notebookId);
		this.#notebooksByKiloSession.set(kiloSessionId, owned);

		const existing = this.#sessions.get(notebookId);
		if (existing) return existing;

		const opening = this.#runtimed
			.openNotebook(notebookId, {
				description: "Kilo Desktop notebook tools",
				peerLabel: NOTEBOOK_PEER_LABEL,
			})
			.catch((error: unknown) => {
				this.#sessions.delete(notebookId);
				throw error;
			});
		this.#sessions.set(notebookId, opening);
		return opening;
	}

	async closeForKiloSession(kiloSessionId: string): Promise<void> {
		const notebookIds = this.#notebooksByKiloSession.get(kiloSessionId);
		if (!notebookIds) return;
		this.#notebooksByKiloSession.delete(kiloSessionId);
		const retained = new Set([...this.#notebooksByKiloSession.values()].flatMap((ids) => [...ids]));
		await Promise.all(
			[...notebookIds]
				.filter((notebookId) => !retained.has(notebookId))
				.map(async (notebookId) => {
					const session = this.#sessions.get(notebookId);
					this.#sessions.delete(notebookId);
					await session?.then((value) => value.close()).catch(() => undefined);
				}),
		);
	}
}

function stripAnsi(value: string): string {
	return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g"), "");
}

function projectCellResult(result: CellResult): ToolResult {
	const text: string[] = [];
	const attachments: ToolAttachment[] = [];
	const seenImages = new Set<string>();

	for (const output of result.outputs ?? []) {
		switch (output.outputType) {
			case "stream":
				text.push(`${output.name === "stderr" ? "[stderr] " : ""}${output.text ?? ""}`);
				break;
			case "execute_result":
			case "display_data": {
				if (!output.dataJson) break;
				let data: Record<string, { type?: string; value?: unknown }>;
				try {
					data = JSON.parse(output.dataJson) as Record<string, { type?: string; value?: unknown }>;
				} catch {
					break;
				}
				const images = Object.entries(data).filter(
					([mime, entry]) =>
						mime.startsWith("image/") &&
						mime !== "image/svg+xml" &&
						entry.type === "binary" &&
						typeof entry.value === "string",
				);
				const textValue = data["text/llm+plain"]?.value ?? data["text/plain"]?.value;
				if (
					typeof textValue === "string" &&
					!(images.length > 0 && /^<Figure[^>]*>/.test(textValue.trim()))
				) {
					text.push(textValue);
				}
				for (const [mime, entry] of images) {
					const value = entry.value as string;
					const key = `${mime}:${value}`;
					if (seenImages.has(key)) continue;
					seenImages.add(key);
					attachments.push({ type: "file", mime, url: `data:${mime};base64,${value}` });
				}
				break;
			}
			case "error":
				text.push(
					output.traceback?.join("\n") || `${output.ename ?? "Error"}: ${output.evalue ?? ""}`,
				);
				break;
			default:
				text.push(`[${output.outputType} output]`);
		}
	}

	const header = `cell ${result.cellId} [${result.executionCount ?? "?"}] ${result.status}`;
	const body = stripAnsi(text.join("").replace(/\n+$/, ""));
	return {
		title: `Notebook cell ${result.executionCount ?? "?"}`,
		output: body ? `${header}\n${body}` : header,
		metadata: {
			notebook_id: undefined,
			cell_id: result.cellId,
			execution_id: result.executionId,
			execution_count: result.executionCount,
			status: result.status,
			success: result.success,
		},
		...(attachments.length ? { attachments } : {}),
	};
}

function parseMetadata(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return {};
	}
}

async function projectCell(
	cell: CellSnapshot,
	executionView: ExecutionView,
	runtimed: RuntimedNode,
	includeOutputs: boolean,
): Promise<Record<string, unknown>> {
	const executionId = executionView.cell_execution_ids[cell.id];
	const snapshot = executionId ? executionView.executions[executionId] : undefined;
	const result =
		executionId && includeOutputs && ["done", "error"].includes(snapshot?.status ?? "")
			? await runtimed.getExecutionResult?.(executionId).catch(() => undefined)
			: undefined;
	return {
		id: cell.id,
		cell_type: cell.cellType,
		position: cell.position,
		source: cell.source,
		metadata: parseMetadata(cell.metadataJson),
		...(executionId && snapshot
			? {
					execution: {
						execution_id: executionId,
						execution_count: snapshot.execution_count,
						status: snapshot.status,
						success: snapshot.success,
						...(result ? { outputs: result.outputs } : {}),
					},
				}
			: {}),
	};
}

export function createNteractKiloPlugin(dependencies: PluginDependencies = {}) {
	return async () => {
		const runtimed = requireRuntimedNode(
			(dependencies.loadRuntimedNode ?? defaultLoadRuntimedNode)(),
		);
		const sessions = new NotebookSessionRegistry(runtimed);
		const read: ToolDefinition<{
			notebook_id: string;
			cell_id?: string;
			include_outputs?: boolean;
		}> = {
			description:
				"Read the visible cells and current execution state from an open notebook. Provide cell_id to read one cell.",
			args: {
				notebook_id: NOTEBOOK_ID,
				cell_id: z.string().min(1).optional(),
				include_outputs: z.boolean().optional(),
			},
			async execute(args, context) {
				const session = await sessions.open(args.notebook_id, context.sessionID);
				const cells = args.cell_id
					? [await session.getCell(args.cell_id)].filter(
							(cell): cell is CellSnapshot => cell !== null,
						)
					: await session.listCells();
				if (args.cell_id && cells.length === 0) {
					throw new Error(`Notebook cell ${args.cell_id} was not found.`);
				}
				const executionView = session.getExecutionView();
				const projected = await Promise.all(
					cells.map((cell) =>
						projectCell(
							cell,
							executionView,
							runtimed,
							args.include_outputs ?? Boolean(args.cell_id),
						),
					),
				);
				return {
					title: args.cell_id ? "Notebook cell" : "Notebook contents",
					output: JSON.stringify({ notebook_id: args.notebook_id, cells: projected }),
					metadata: { notebook_id: args.notebook_id, cell_count: projected.length },
				};
			},
		};

		const runCell: ToolDefinition<{
			notebook_id: string;
			code: string;
			dependencies?: string[];
			timeout_secs?: number;
		}> = {
			description:
				"Append and execute a visible code cell in an open notebook. State persists between calls.",
			args: {
				notebook_id: NOTEBOOK_ID,
				code: z.string().min(1).describe("Python source to append and execute."),
				dependencies: z.array(z.string().min(1)).optional(),
				timeout_secs: z.number().positive().max(3600).optional(),
			},
			async execute(args, context) {
				if (context.abort.aborted) throw new Error("Notebook execution was cancelled.");
				const session = await sessions.open(args.notebook_id, context.sessionID);
				if (args.dependencies?.length) {
					await session.addDependencies(args.dependencies);
					await session.syncEnvironment();
				}
				const result = await session.runCell(args.code, {
					timeoutMs: Math.round((args.timeout_secs ?? 120) * 1000),
				});
				const projected = projectCellResult(result);
				return {
					...projected,
					metadata: { ...projected.metadata, notebook_id: args.notebook_id },
				};
			},
		};

		const createCell: ToolDefinition<{
			notebook_id: string;
			source?: string;
			cell_type?: "code" | "markdown" | "raw";
			after_cell_id?: string | null;
			and_run?: boolean;
			timeout_secs?: number;
		}> = {
			description:
				"Create a notebook cell at a specific position, optionally executing a new code cell immediately.",
			args: {
				notebook_id: NOTEBOOK_ID,
				source: z.string().optional(),
				cell_type: z.enum(["code", "markdown", "raw"]).optional(),
				after_cell_id: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe("Omit to append, or pass null to insert at the beginning."),
				and_run: z.boolean().optional(),
				timeout_secs: z.number().positive().max(3600).optional(),
			},
			async execute(args, context) {
				if (context.abort.aborted) throw new Error("Notebook cell creation was cancelled.");
				const session = await sessions.open(args.notebook_id, context.sessionID);
				const cellType = args.cell_type ?? "code";
				const cellId = await session.createCell(args.source ?? "", {
					cellType,
					...(args.after_cell_id === null ? { index: 0 } : {}),
					...(typeof args.after_cell_id === "string" ? { afterCellId: args.after_cell_id } : {}),
				});
				if (args.and_run && cellType === "code") {
					const result = await session.executeCell(cellId, {
						timeoutMs: Math.round((args.timeout_secs ?? 120) * 1000),
					});
					const projected = projectCellResult(result);
					return {
						...projected,
						title: "Notebook cell created and executed",
						metadata: { ...projected.metadata, notebook_id: args.notebook_id },
					};
				}
				return {
					title: "Notebook cell created",
					output: JSON.stringify({
						notebook_id: args.notebook_id,
						cell_id: cellId,
						cell_type: cellType,
					}),
					metadata: { notebook_id: args.notebook_id, cell_id: cellId, cell_type: cellType },
				};
			},
		};

		type EditOperation =
			| {
					action: "update";
					cell_id: string;
					source?: string;
					cell_type?: "code" | "markdown" | "raw";
			  }
			| { action: "delete"; cell_id: string }
			| { action: "move"; cell_id: string; after_cell_id?: string | null };
		const editCells: ToolDefinition<{
			notebook_id: string;
			operations: EditOperation[];
		}> = {
			description:
				"Apply an ordered batch of updates, moves, and deletes to existing notebook cells.",
			args: {
				notebook_id: NOTEBOOK_ID,
				operations: z
					.array(
						z.discriminatedUnion("action", [
							z.object({
								action: z.literal("update"),
								cell_id: z.string().min(1),
								source: z.string().optional(),
								cell_type: z.enum(["code", "markdown", "raw"]).optional(),
							}),
							z.object({ action: z.literal("delete"), cell_id: z.string().min(1) }),
							z.object({
								action: z.literal("move"),
								cell_id: z.string().min(1),
								after_cell_id: z.string().min(1).nullable().optional(),
							}),
						]),
					)
					.min(1)
					.max(100),
			},
			async execute(args, context) {
				const session = await sessions.open(args.notebook_id, context.sessionID);
				const results: Array<Record<string, unknown>> = [];
				for (const operation of args.operations) {
					if (context.abort.aborted) throw new Error("Notebook edit was cancelled.");
					switch (operation.action) {
						case "update": {
							const updated = await session.setCell(operation.cell_id, {
								...(operation.source !== undefined ? { source: operation.source } : {}),
								...(operation.cell_type ? { cellType: operation.cell_type } : {}),
							});
							results.push({ action: operation.action, cell_id: operation.cell_id, updated });
							break;
						}
						case "move": {
							const position = await session.moveCell(operation.cell_id, operation.after_cell_id);
							results.push({ action: operation.action, cell_id: operation.cell_id, position });
							break;
						}
						case "delete": {
							const deleted = await session.deleteCell(operation.cell_id);
							results.push({ action: operation.action, cell_id: operation.cell_id, deleted });
							break;
						}
					}
				}
				return {
					title: "Notebook cells updated",
					output: JSON.stringify({ notebook_id: args.notebook_id, results }),
					metadata: { notebook_id: args.notebook_id, operation_count: results.length },
				};
			},
		};

		const execute: ToolDefinition<{
			notebook_id: string;
			cell_ids?: string[];
			timeout_secs?: number;
			stop_on_error?: boolean;
		}> = {
			description:
				"Execute selected existing notebook cells in order. When cell_ids is omitted, execute every code cell in notebook order.",
			args: {
				notebook_id: NOTEBOOK_ID,
				cell_ids: z.array(z.string().min(1)).min(1).max(100).optional(),
				timeout_secs: z.number().positive().max(3600).optional(),
				stop_on_error: z.boolean().optional(),
			},
			async execute(args, context) {
				const session = await sessions.open(args.notebook_id, context.sessionID);
				const cellIds =
					args.cell_ids ??
					(await session.listCells())
						.filter((cell) => cell.cellType === "code")
						.map((cell) => cell.id);
				const results: CellResult[] = [];
				for (const cellId of cellIds) {
					if (context.abort.aborted) throw new Error("Notebook execution was cancelled.");
					const result = await session.executeCell(cellId, {
						timeoutMs: Math.round((args.timeout_secs ?? 120) * 1000),
					});
					results.push(result);
					if (!result.success && (args.stop_on_error ?? true)) break;
				}
				const projected = results.map(projectCellResult);
				const attachments = projected.flatMap((result) => result.attachments ?? []);
				return {
					title: `Executed ${results.length} notebook cell${results.length === 1 ? "" : "s"}`,
					output: projected.map((result) => result.output).join("\n\n"),
					metadata: {
						notebook_id: args.notebook_id,
						cell_ids: results.map((result) => result.cellId),
						execution_ids: results.map((result) => result.executionId),
						status: results.every((result) => result.success) ? "done" : "error",
					},
					...(attachments.length ? { attachments } : {}),
				};
			},
		};

		const dependenciesTool: ToolDefinition<{
			notebook_id: string;
			action: "status" | "add" | "remove" | "sync" | "approve_trust";
			packages?: string[];
			package_manager?: "uv" | "conda" | "pixi";
			observed_heads?: string[];
		}> = {
			description:
				"Inspect or update the notebook environment. Add and remove synchronize immediately; approving trust always asks the user first.",
			args: {
				notebook_id: NOTEBOOK_ID,
				action: z.enum(["status", "add", "remove", "sync", "approve_trust"]),
				packages: z.array(z.string().min(1)).min(1).max(100).optional(),
				package_manager: z.enum(["uv", "conda", "pixi"]).optional(),
				observed_heads: z.array(z.string().min(1)).optional(),
			},
			async execute(args, context) {
				const session = await sessions.open(args.notebook_id, context.sessionID);
				const editOptions = args.package_manager
					? { packageManager: args.package_manager }
					: undefined;
				switch (args.action) {
					case "add":
						if (!args.packages?.length) throw new Error("packages is required for action add.");
						await session.addDependencies(args.packages, editOptions);
						await session.syncEnvironment();
						break;
					case "remove":
						if (!args.packages?.length) throw new Error("packages is required for action remove.");
						await session.removeDependencies(args.packages, editOptions);
						await session.syncEnvironment();
						break;
					case "sync":
						await session.syncEnvironment();
						break;
					case "approve_trust":
						await context.ask({
							permission: "notebooks_trust",
							patterns: [args.notebook_id],
							always: [args.notebook_id],
							metadata: {
								notebook_id: args.notebook_id,
								observed_heads: args.observed_heads ?? [],
							},
						});
						await session.approveTrust(args.observed_heads);
						break;
					case "status":
						break;
				}
				const status = await session.getDependencyStatus();
				return {
					title: "Notebook dependencies",
					output: JSON.stringify({ notebook_id: args.notebook_id, action: args.action, status }),
					metadata: { notebook_id: args.notebook_id, action: args.action },
				};
			},
		};

		const kernel: ToolDefinition<{
			notebook_id: string;
			action: "status" | "interrupt" | "restart";
		}> = {
			description: "Inspect, interrupt, or restart the kernel for an open notebook.",
			args: {
				notebook_id: NOTEBOOK_ID,
				action: z.enum(["status", "interrupt", "restart"]),
			},
			async execute(args, context) {
				const session = await sessions.open(args.notebook_id, context.sessionID);
				if (args.action === "interrupt") await session.interruptKernel();
				if (args.action === "restart") await session.restartKernel();
				const status = await session.getRuntimeStatus();
				return {
					title: "Notebook kernel",
					output: JSON.stringify({ notebook_id: args.notebook_id, action: args.action, status }),
					metadata: { notebook_id: args.notebook_id, action: args.action },
				};
			},
		};

		const save: ToolDefinition<{
			notebook_id: string;
			path?: string;
		}> = {
			description:
				"Save an open notebook, optionally to an .ipynb path. Paths outside the Kilo workspace require user approval.",
			args: {
				notebook_id: NOTEBOOK_ID,
				path: z.string().min(1).optional(),
			},
			async execute(args, context) {
				const session = await sessions.open(args.notebook_id, context.sessionID);
				if (!args.path) {
					await session.saveNotebook();
					return {
						title: "Notebook saved",
						output: "Saved to the notebook's current path.",
						metadata: { notebook_id: args.notebook_id },
					};
				}

				const targetPath = path.resolve(context.worktree, args.path);
				if (path.extname(targetPath).toLowerCase() !== ".ipynb") {
					throw new Error("Notebook save paths must end in .ipynb.");
				}
				const relativePath = path.relative(context.worktree, targetPath);
				const isInsideWorkspace =
					relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
				if (!isInsideWorkspace) {
					await context.ask({
						permission: "external_directory",
						patterns: [targetPath],
						always: [],
						metadata: { notebook_id: args.notebook_id, path: targetPath },
					});
				}
				await session.saveNotebook(targetPath);
				return {
					title: "Notebook saved",
					output: targetPath,
					metadata: { notebook_id: args.notebook_id, path: targetPath },
				};
			},
		};

		return {
			tool: {
				notebooks_create_cell: createCell,
				notebooks_dependencies: dependenciesTool,
				notebooks_edit_cells: editCells,
				notebooks_execute: execute,
				notebooks_kernel: kernel,
				notebooks_read: read,
				notebooks_run_cell: runCell,
				notebooks_save: save,
			},
			event: async ({
				event,
			}: {
				event: { type: string; properties?: Record<string, unknown> };
			}) => {
				if (event.type !== "session.deleted") return;
				const sessionId = event.properties?.sessionID;
				if (typeof sessionId === "string") await sessions.closeForKiloSession(sessionId);
			},
		};
	};
}

const plugin = createNteractKiloPlugin();

export default { id: "anaconda-notebooks", server: plugin };
