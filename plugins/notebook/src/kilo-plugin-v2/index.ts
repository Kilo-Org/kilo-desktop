import { realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { z } from "zod";

import type { CellResult, CellSnapshot, ExecutionView, Session } from "@runtimed/node";

import { checkTyposquats } from "../shared/typosquat";

import {
	declaredDependencySpecs,
	dependencyTrust,
	pendingApprovalLabels,
	requireDependencyApproval,
	TRUST_PERMISSION,
	withTrustGuidance,
} from "./dependency-approval";
import { EXECUTE_PERMISSION, requireExecutionApproval } from "./execution-approval";

import {
	type FileContent,
	type PermissionEffect,
	type PermissionRule,
	type PluginContext,
	type Tool,
	type ToolCall,
	type ToolResult,
	assertForCall,
} from "./kilo-api";

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

const OPEN_FILE_TOOL = "desktop_notebook_open_file";
const LIST_OPEN_TOOL = "desktop_notebook_list_open";
/**
 * A plain string rather than `z.uuid()`: Kilo validates input against this
 * schema before `execute()`, and a malformed id must still reach
 * `assertNotebookUuid`, which answers a workspace notebook name with the exact
 * open_file call. The description carries the UUID contract to the model.
 */
const NOTEBOOK_ID = z
	.string()
	.describe(
		`Notebook UUID from ${LIST_OPEN_TOOL}, desktop_notebook_open, or ${OPEN_FILE_TOOL}. Not a file name or path; open .ipynb files with ${OPEN_FILE_TOOL} first.`,
	);
const NOTEBOOK_UUID = z.uuid();
const NOTEBOOK_PEER_LABEL = "Kilo Desktop";

/** The Kilo session that opens a notebook, and the workspace its ids resolve against. */
type NotebookOwner = { readonly sessionID: string; readonly directory: string };

/** Canonical path of an existing `.ipynb` file inside the workspace, after following symlinks. */
async function workspaceNotebookPath(name: string, directory: string): Promise<string | null> {
	if (path.extname(name).toLowerCase() !== ".ipynb") return null;
	try {
		const [root, target] = await Promise.all([
			realpath(directory),
			realpath(path.resolve(directory, name)),
		]);
		const relative = path.relative(root, target);
		const inside =
			relative !== "" &&
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative);
		if (!inside) return null;
		return (await stat(target)).isFile() ? target : null;
	} catch {
		return null;
	}
}

/**
 * The input schema does not enforce the UUID format (see `NOTEBOOK_ID`), and
 * the daemon reads any non-UUID notebook id as a file path. Tools therefore address notebooks
 * only by the UUID the chat pane reports, which keeps every notebook an agent
 * edits visible to the user. A workspace notebook name is answered with the
 * exact open_file call rather than opened out of view.
 */
async function assertNotebookUuid(notebookId: string, directory: string): Promise<void> {
	if (NOTEBOOK_UUID.safeParse(notebookId).success) return;
	const notebookPath = await workspaceNotebookPath(notebookId, directory);
	if (notebookPath) {
		throw new Error(
			`notebook_id must be a notebook UUID. ${JSON.stringify(notebookId)} is ${notebookPath} in this workspace; ` +
				`open it with ${OPEN_FILE_TOOL} {"path": ${JSON.stringify(notebookPath)}} and use the notebook_id it returns.`,
		);
	}
	throw new Error(
		`notebook_id must be a notebook UUID from ${LIST_OPEN_TOOL} or ${OPEN_FILE_TOOL}; got ${JSON.stringify(notebookId)}.`,
	);
}

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

type StatusSubscription = { unsubscribe(): void };

// The native SyncStatus payload carries `connection`, but @runtimed/node's
// SessionStatus type omits it, so read it structurally.
function isDisconnectedStatus(status: unknown): boolean {
	return (
		typeof status === "object" &&
		status !== null &&
		(status as { connection?: unknown }).connection === "Disconnected"
	);
}

/**
 * Owns native notebook peers for one Kilo workspace plugin instance. Only
 * notebook UUIDs are admitted, and the check runs before any ownership or cache
 * entry is recorded. Concurrent opens coalesce, and failed opens leave no stale
 * cache entry. Kilo session
 * ownership is tracked separately so session deletion can release only peers
 * that are no longer referenced by another chat.
 *
 * Native mutations (setCell, createCell, ...) only write the peer's local
 * replica and return before the daemon sees them. If the peer's sync task dies,
 * it never reconnects, yet mutations keep "succeeding" locally. The registry
 * therefore watches each peer's session status and evicts disconnected peers so
 * the next tool call reopens a live one; `assertConnected` lets mutating tools
 * report a lost connection instead of claiming their edits were applied.
 */
class NotebookSessionRegistry {
	readonly #runtimed: RuntimedNode;
	readonly #sessions = new Map<string, Promise<Session>>();
	readonly #statusSubscriptions = new Map<string, StatusSubscription>();
	readonly #disconnected = new WeakSet<Session>();
	readonly #notebooksByKiloSession = new Map<string, Set<string>>();

	constructor(runtimed: RuntimedNode) {
		this.#runtimed = runtimed;
	}

	async open(notebookId: string, owner: NotebookOwner): Promise<Session> {
		await assertNotebookUuid(notebookId, owner.directory);
		const owned = this.#notebooksByKiloSession.get(owner.sessionID) ?? new Set<string>();
		owned.add(notebookId);
		this.#notebooksByKiloSession.set(owner.sessionID, owned);

		const existing = this.#sessions.get(notebookId);
		if (existing) return existing;

		const opening = this.#runtimed
			.openNotebook(notebookId, {
				description: "Kilo Desktop notebook tools",
				peerLabel: NOTEBOOK_PEER_LABEL,
			})
			.then(
				(session) => {
					this.#watchStatus(notebookId, session, opening);
					return session;
				},
				(error: unknown) => {
					this.#sessions.delete(notebookId);
					throw error;
				},
			);
		this.#sessions.set(notebookId, opening);
		return opening;
	}

	assertConnected(session: Session): void {
		if (this.#disconnected.has(session)) {
			throw new Error(
				"The notebook connection was lost, so these changes may not have reached the notebook. Re-read the notebook and retry.",
			);
		}
	}

	async closeForKiloSession(kiloSessionId: string): Promise<void> {
		const notebookIds = this.#notebooksByKiloSession.get(kiloSessionId);
		if (!notebookIds) return;
		this.#notebooksByKiloSession.delete(kiloSessionId);
		const retained = new Set([...this.#notebooksByKiloSession.values()].flatMap((ids) => [...ids]));
		await Promise.all(
			[...notebookIds]
				.filter((notebookId) => !retained.has(notebookId))
				.map((notebookId) => this.#release(notebookId)),
		);
	}

	/** Releases every peer, for plugin cleanup. */
	async closeAll(): Promise<void> {
		this.#notebooksByKiloSession.clear();
		await Promise.all([...this.#sessions.keys()].map((notebookId) => this.#release(notebookId)));
	}

	#watchStatus(notebookId: string, session: Session, opening: Promise<Session>): void {
		const subscription = session.sessionStatus$?.subscribe((status) => {
			if (!isDisconnectedStatus(status)) return;
			this.#disconnected.add(session);
			if (this.#sessions.get(notebookId) === opening) void this.#release(notebookId);
		});
		if (subscription) this.#statusSubscriptions.set(notebookId, subscription);
	}

	async #release(notebookId: string): Promise<void> {
		const session = this.#sessions.get(notebookId);
		this.#sessions.delete(notebookId);
		this.#statusSubscriptions.get(notebookId)?.unsubscribe();
		this.#statusSubscriptions.delete(notebookId);
		await session?.then((value) => value.close()).catch(() => undefined);
	}
}

function stripAnsi(value: string): string {
	return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g"), "");
}

type ProjectedCell = { text: string; files: FileContent[]; metadata: Record<string, unknown> };

function projectCellResult(notebookId: string, result: CellResult): ProjectedCell {
	const text: string[] = [];
	const files: FileContent[] = [];
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
					files.push({ type: "file", mime, uri: `data:${mime};base64,${value}` });
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
		text: body ? `${header}\n${body}` : header,
		files,
		metadata: {
			notebook_id: notebookId,
			cell_id: result.cellId,
			execution_id: result.executionId,
			execution_count: result.executionCount,
			status: result.status,
			success: result.success,
		},
	};
}

/** A tool result whose content is `text`, then any `files`. */
function toolResult(
	text: string,
	metadata: Record<string, unknown>,
	files: readonly FileContent[] = [],
): ToolResult {
	return { content: [{ type: "text", text }, ...files], metadata };
}

function cellToolResult(projected: ProjectedCell, title: string): ToolResult {
	return toolResult(projected.text, { title, ...projected.metadata }, projected.files);
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

type RuntimeStatus = Awaited<ReturnType<Session["getRuntimeStatus"]>>;

type KernelError = { reason?: string; details?: string };

function kernelErrorOf(status: RuntimeStatus): KernelError | undefined {
	const reason = status.errorReason?.trim();
	const details = status.errorDetails ? stripAnsi(status.errorDetails).trim() : undefined;
	if (!reason && !details) return undefined;
	return { ...(reason ? { reason } : {}), ...(details ? { details } : {}) };
}

function formatKernelError(error: KernelError): string {
	return [error.reason, error.details].filter(Boolean).join(": ");
}

// Auxiliary context for other tools: a status read failure must not mask their result.
async function readKernelError(session: Session): Promise<KernelError | undefined> {
	try {
		return kernelErrorOf(await session.getRuntimeStatus());
	} catch {
		return undefined;
	}
}

const APPROVAL_HINT =
	"The user can click Review in the notebook's banner, or use notebooks_dependencies action approve_trust.";

function summarizeKernelState(
	status: RuntimeStatus,
	error: KernelError | undefined,
	pendingApproval: readonly string[],
): string {
	if (status.lifecycle === "Error") {
		return error
			? `Kernel failed to start: ${formatKernelError(error)}`
			: "Kernel failed to start.";
	}
	const pendingList = pendingApproval.length > 0 ? `: ${pendingApproval.join(", ")}` : "";
	const state =
		status.lifecycle === "AwaitingTrust"
			? `Kernel is waiting for the user to approve the notebook dependencies${pendingList}. ${APPROVAL_HINT}`
			: status.lifecycle === "AwaitingEnvBuild"
				? "Kernel is waiting for the environment.yml conda environment to be built."
				: status.lifecycle === "Running"
					? `Kernel is running (${status.activity ?? "unknown activity"}).`
					: `Kernel lifecycle: ${status.lifecycle}.`;
	const approval =
		status.lifecycle !== "AwaitingTrust" && pendingApproval.length > 0
			? ` Dependencies need approval before they can be installed${pendingList}. ${APPROVAL_HINT}`
			: "";
	return `${state}${approval}${error ? ` Last kernel error: ${formatKernelError(error)}` : ""}`;
}

const PROMPTED_PERMISSIONS = [TRUST_PERMISSION, EXECUTE_PERMISSION];

/** Kilo v2's permission wildcard (`packages/core/src/util/wildcard.ts`): `*` any run, `?` one character. */
function wildcardMatch(input: string, pattern: string): boolean {
	let escaped = pattern
		.replaceAll("\\", "/")
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`;
	return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(
		input.replaceAll("\\", "/"),
	);
}

// A resource no real pattern names, so only rules covering every resource match it.
const ANY_RESOURCE = "\u0000";

/** The effect Kilo's last-match-wins evaluation gives `action` for a resource no rule names. */
function catchAllEffect(action: string, rules: readonly PermissionRule[]): PermissionEffect {
	return (
		rules.findLast(
			(rule) => wildcardMatch(action, rule.action) && wildcardMatch(ANY_RESOURCE, rule.resource),
		)?.effect ?? "ask"
	);
}

function targetsAction(rule: PermissionRule, action: string): boolean {
	return rule.action !== "*" && wildcardMatch(action, rule.action);
}

/**
 * Kilo v2 builds each agent's permissions as an ordered rule array (built-in defaults, often a
 * leading `{ action: "*", resource: "*", effect: "allow" }`, then the user's
 * config rules) and evaluates the last matching rule. Without an explicit rule,
 * dependency approvals and notebook code execution would ride the catch-all
 * allow and never reach the user, so each agent gets a trailing `ask` for them.
 *
 * - A rule the user wrote for the action (exact, or a wildcard such as
 *   `notebooks_*`) covering every resource is their choice and is left alone.
 * - Rules naming only specific resources get the `ask` inserted before them so
 *   they still win for their resources.
 * - An action the agent already denies stays denied: `ask` is never added where
 *   it would weaken a deny (e.g. read-only agents ending in `* * deny`).
 *
 * Saved "Always allow" approvals are evaluated after agent and session rules,
 * so they still win over this `ask`.
 */
export function requireNotebookPrompts(permissions: PermissionRule[]): void {
	for (const action of PROMPTED_PERMISSIONS) {
		const ask: PermissionRule = { action, resource: "*", effect: "ask" };
		const userRules = permissions.filter((rule) => targetsAction(rule, action));
		if (userRules.some((rule) => wildcardMatch(ANY_RESOURCE, rule.resource))) continue;
		const insertAt = userRules.length > 0 ? permissions.indexOf(userRules[0]!) : permissions.length;
		if (catchAllEffect(action, permissions.slice(0, insertAt)) === "deny") continue;
		permissions.splice(insertAt, 0, ask);
	}
}

type DependencyStatus = Awaited<ReturnType<Session["getDependencyStatus"]>>;

/** Agent-facing view of what is waiting for approval; omitted when nothing is. */
function approvalReport(status: DependencyStatus) {
	const trust = dependencyTrust(status);
	return trust.needsApproval
		? { approval: { needs_approval: true, unapproved: pendingApprovalLabels(trust) } }
		: {};
}

// Strict objects so a misspelled key (e.g. "sourc") fails validation instead
// of being stripped into a silent no-op update.
const EDIT_OPERATION = z.discriminatedUnion("action", [
	z.strictObject({
		action: z.literal("update"),
		cell_id: z.string().min(1),
		source: z.string().optional(),
		cell_type: z.enum(["code", "markdown", "raw"]).optional(),
	}),
	z.strictObject({ action: z.literal("delete"), cell_id: z.string().min(1) }),
	z.strictObject({
		action: z.literal("move"),
		cell_id: z.string().min(1),
		after_cell_id: z.string().min(1).nullable().optional(),
	}),
]);

type EditOperation = z.output<typeof EDIT_OPERATION>;

// The native layer silently appends when an anchor cell is unknown, so a stale
// after_cell_id would otherwise "succeed" at the wrong position.
async function assertAnchorExists(session: Session, afterCellId: string | null | undefined) {
	if (typeof afterCellId === "string" && !(await session.getCell(afterCellId))) {
		throw new Error(`after_cell_id ${afterCellId} was not found`);
	}
}

/**
 * 1-based places in the notebook, markdown included, as a person counts cells
 * scrolling it; a cell's `position` is an opaque fractional index. Unknown ids
 * get no number (executing them fails anyway).
 */
function cellNumbersOf(cells: readonly CellSnapshot[], cellIds: readonly string[]): number[] {
	const numbers = new Map(cells.map((cell, index) => [cell.id, index + 1]));
	return cellIds.flatMap((id) => {
		const number = numbers.get(id);
		return number === undefined ? [] : [number];
	});
}

/** Applies one edit to the local replica; resolves to null when the cell does not exist. */
async function applyEditOperation(
	session: Session,
	operation: EditOperation,
): Promise<Record<string, unknown> | null> {
	switch (operation.action) {
		case "update": {
			const updated = await session.setCell(operation.cell_id, {
				...(operation.source !== undefined ? { source: operation.source } : {}),
				...(operation.cell_type ? { cellType: operation.cell_type } : {}),
			});
			return updated ? {} : null;
		}
		case "move":
			// A missing cell_id makes the native moveCell throw; only the anchor needs checking.
			await assertAnchorExists(session, operation.after_cell_id);
			return { position: await session.moveCell(operation.cell_id, operation.after_cell_id) };
		case "delete":
			return (await session.deleteCell(operation.cell_id)) ? {} : null;
	}
}

const TIMEOUT_SECS = z.number().positive().max(3600).optional();

function timeoutMs(timeoutSecs: number | undefined): number {
	return Math.round((timeoutSecs ?? 120) * 1000);
}

/**
 * Offered individually rather than through Code Mode: Desktop's tool renderers
 * and permission cards key on the `notebooks_*` calls.
 */
function defineTool<Input extends z.ZodObject>(tool: Omit<Tool<Input>, "options">): Tool<Input> {
	return { ...tool, options: { codemode: false } };
}

/** `dir/*` for the directory holding `file`, as Kilo's own file tools scope external access. */
function externalDirectoryResource(file: string): string {
	return path.join(path.dirname(file), "*").replaceAll("\\", "/");
}

function notebookTools(
	ctx: PluginContext,
	runtimed: RuntimedNode,
	sessions: NotebookSessionRegistry,
): Tool[] {
	const { directory } = ctx.location;
	const { permission } = ctx;
	const open = (notebookId: string, call: ToolCall) =>
		sessions.open(notebookId, { sessionID: call.sessionID, directory });

	const read = defineTool({
		name: "notebooks_read",
		description:
			"Read the visible cells and current execution state from an open notebook. Provide cell_id to read one cell.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			cell_id: z.string().min(1).optional(),
			include_outputs: z.boolean().optional(),
		}),
		async execute(input, context) {
			const session = await open(input.notebook_id, context);
			const cells = input.cell_id
				? [await session.getCell(input.cell_id)].filter(
						(cell): cell is CellSnapshot => cell !== null,
					)
				: await session.listCells();
			if (input.cell_id && cells.length === 0) {
				throw new Error(`Notebook cell ${input.cell_id} was not found.`);
			}
			const executionView = session.getExecutionView();
			const projected = await Promise.all(
				cells.map((cell) =>
					projectCell(
						cell,
						executionView,
						runtimed,
						input.include_outputs ?? Boolean(input.cell_id),
					),
				),
			);
			return toolResult(JSON.stringify({ notebook_id: input.notebook_id, cells: projected }), {
				title: input.cell_id ? "Notebook cell" : "Notebook contents",
				notebook_id: input.notebook_id,
				cell_count: projected.length,
			});
		},
	});

	const runCell = defineTool({
		name: "notebooks_run_cell",
		description:
			"Append and execute a visible code cell in an open notebook. State persists between calls.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			code: z.string().min(1).describe("Python source to append and execute."),
			dependencies: z.array(z.string().min(1)).optional(),
			timeout_secs: TIMEOUT_SECS,
		}),
		async execute(input, context) {
			if (context.signal.aborted) throw new Error("Notebook execution was cancelled.");
			const session = await open(input.notebook_id, context);
			await requireExecutionApproval(permission, context, input.notebook_id, {
				kind: "run",
				code: input.code,
			});
			if (input.dependencies?.length) {
				await requireDependencyApproval(permission, context, session, input.notebook_id, {
					kind: "add",
					packages: input.dependencies,
				});
				await session.addDependencies(input.dependencies);
				await withTrustGuidance(session, () => session.syncEnvironment());
			}
			const result = await withTrustGuidance(session, () =>
				session.runCell(input.code, { timeoutMs: timeoutMs(input.timeout_secs) }),
			);
			return cellToolResult(
				projectCellResult(input.notebook_id, result),
				`Notebook cell ${result.executionCount ?? "?"}`,
			);
		},
	});

	const createCell = defineTool({
		name: "notebooks_create_cell",
		description:
			"Create a notebook cell at a specific position, optionally executing a new code cell immediately.",
		input: z.object({
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
			timeout_secs: TIMEOUT_SECS,
		}),
		async execute(input, context) {
			if (context.signal.aborted) throw new Error("Notebook cell creation was cancelled.");
			const session = await open(input.notebook_id, context);
			const cellType = input.cell_type ?? "code";
			const runAfterCreate = Boolean(input.and_run) && cellType === "code";
			await assertAnchorExists(session, input.after_cell_id);
			if (runAfterCreate) {
				await requireExecutionApproval(permission, context, input.notebook_id, {
					kind: "run",
					code: input.source ?? "",
				});
			}
			const cellId = await session.createCell(input.source ?? "", {
				cellType,
				...(input.after_cell_id === null ? { index: 0 } : {}),
				...(typeof input.after_cell_id === "string" ? { afterCellId: input.after_cell_id } : {}),
			});
			sessions.assertConnected(session);
			if (runAfterCreate) {
				const result = await withTrustGuidance(session, () =>
					session.executeCell(cellId, { timeoutMs: timeoutMs(input.timeout_secs) }),
				);
				return cellToolResult(
					projectCellResult(input.notebook_id, result),
					"Notebook cell created and executed",
				);
			}
			const created = { notebook_id: input.notebook_id, cell_id: cellId, cell_type: cellType };
			return toolResult(JSON.stringify(created), { title: "Notebook cell created", ...created });
		},
	});

	const editCells = defineTool({
		name: "notebooks_edit_cells",
		description:
			"Apply an ordered batch of updates, moves, and deletes to existing notebook cells.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			operations: z.array(EDIT_OPERATION).min(1).max(100),
		}),
		async execute(input, context) {
			input.operations.forEach((operation, index) => {
				if (
					operation.action === "update" &&
					operation.source === undefined &&
					operation.cell_type === undefined
				) {
					throw new Error(
						`Operation ${index + 1} (update ${operation.cell_id}) must set source or cell_type. No operations were applied.`,
					);
				}
			});

			const session = await open(input.notebook_id, context);
			const results: Array<Record<string, unknown>> = [];
			const failAt = (index: number, operation: EditOperation, reason: string): never => {
				throw new Error(
					`Operation ${index + 1} (${operation.action} ${operation.cell_id}) failed: ${reason}. ` +
						`Applied before the failure: ${JSON.stringify(results)}. Re-read the notebook before retrying.`,
				);
			};
			for (const [index, operation] of input.operations.entries()) {
				if (context.signal.aborted) failAt(index, operation, "the edit was cancelled");
				let result: Record<string, unknown> | null;
				try {
					// Edits apply in the caller's order and stop at the first failure.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					result = await applyEditOperation(session, operation);
				} catch (error) {
					return failAt(index, operation, error instanceof Error ? error.message : String(error));
				}
				if (!result) failAt(index, operation, "cell not found");
				results.push({ action: operation.action, cell_id: operation.cell_id, ...result });
			}
			sessions.assertConnected(session);
			return toolResult(JSON.stringify({ notebook_id: input.notebook_id, results }), {
				title: "Notebook cells updated",
				notebook_id: input.notebook_id,
				operation_count: results.length,
			});
		},
	});

	const execute = defineTool({
		name: "notebooks_execute",
		description:
			"Execute selected existing notebook cells in order. When cell_ids is omitted, execute every code cell in notebook order.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			cell_ids: z.array(z.string().min(1)).min(1).max(100).optional(),
			timeout_secs: TIMEOUT_SECS,
			stop_on_error: z.boolean().optional(),
		}),
		async execute(input, context) {
			const session = await open(input.notebook_id, context);
			const cells = await session.listCells();
			const cellIds =
				input.cell_ids ?? cells.filter((cell) => cell.cellType === "code").map((cell) => cell.id);
			if (cellIds.length > 0) {
				await requireExecutionApproval(permission, context, input.notebook_id, {
					kind: "execute",
					cellIds,
					cellNumbers: cellNumbersOf(cells, cellIds),
					allCells: input.cell_ids === undefined,
				});
			}
			const results: CellResult[] = [];
			for (const cellId of cellIds) {
				if (context.signal.aborted) throw new Error("Notebook execution was cancelled.");
				const result = await withTrustGuidance(session, () =>
					session.executeCell(cellId, { timeoutMs: timeoutMs(input.timeout_secs) }),
				);
				results.push(result);
				if (!result.success && (input.stop_on_error ?? true)) break;
			}
			const projected = results.map((result) => projectCellResult(input.notebook_id, result));
			return toolResult(
				projected.map((cell) => cell.text).join("\n\n"),
				{
					title: `Executed ${results.length} notebook cell${results.length === 1 ? "" : "s"}`,
					notebook_id: input.notebook_id,
					cell_ids: results.map((result) => result.cellId),
					execution_ids: results.map((result) => result.executionId),
					status: results.every((result) => result.success) ? "done" : "error",
				},
				projected.flatMap((cell) => cell.files),
			);
		},
	});

	const dependencies = defineTool({
		name: "notebooks_dependencies",
		description:
			"Inspect or update the notebook environment. Add and remove synchronize immediately. " +
			"Adding, removing, or approving asks the user first whenever it would approve packages " +
			"the machine has not approved yet, including dependencies the notebook already declares; " +
			"suspected typosquats are flagged in that prompt. Status reports what is waiting for approval.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			action: z.enum(["status", "add", "remove", "sync", "approve_trust"]),
			packages: z.array(z.string().min(1)).min(1).max(100).optional(),
			package_manager: z.enum(["uv", "conda", "pixi"]).optional(),
		}),
		async execute(input, context) {
			if ((input.action === "add" || input.action === "remove") && !input.packages?.length) {
				throw new Error(`packages is required for action ${input.action}.`);
			}
			const packages = input.packages ?? [];
			const session = await open(input.notebook_id, context);
			const editOptions = input.package_manager
				? { packageManager: input.package_manager }
				: undefined;
			const approve = (change: Parameters<typeof requireDependencyApproval>[4]) =>
				requireDependencyApproval(permission, context, session, input.notebook_id, change);
			const syncEnvironment = () => withTrustGuidance(session, () => session.syncEnvironment());
			switch (input.action) {
				case "add":
					await approve({ kind: "add", packages });
					await session.addDependencies(packages, editOptions);
					await syncEnvironment();
					break;
				case "remove":
					await approve({ kind: "remove", packages });
					await session.removeDependencies(packages, editOptions);
					await syncEnvironment();
					break;
				case "sync":
					await syncEnvironment();
					break;
				case "approve_trust":
					if (await approve({ kind: "approve" })) await session.approveTrust(undefined);
					break;
				case "status":
					break;
			}
			const [status, kernelError] = await Promise.all([
				session.getDependencyStatus(),
				readKernelError(session),
			]);
			const typosquatWarnings = checkTyposquats(declaredDependencySpecs(status));
			return toolResult(
				JSON.stringify({
					notebook_id: input.notebook_id,
					action: input.action,
					status,
					...approvalReport(status),
					...(kernelError ? { kernel_error: kernelError } : {}),
					...(typosquatWarnings.length ? { typosquat_warnings: typosquatWarnings } : {}),
				}),
				{ title: "Notebook dependencies", notebook_id: input.notebook_id, action: input.action },
			);
		},
	});

	const diagnose = defineTool({
		name: "notebooks_diagnose",
		description:
			"Diagnose why a notebook is broken: kernel failed to start, environment or conda/uv/pixi " +
			"install errors, environment.yml problems, missing ipykernel, pending dependency trust, or " +
			"dependency names that look like typosquats of popular packages. " +
			"Returns the exact kernel error the user sees in the notebook, plus kernel state and " +
			"dependency metadata. Use this first when the user reports a notebook error or asks what went " +
			`wrong. Get notebook_id from ${LIST_OPEN_TOOL}. After fixing the cause, restart the ` +
			"kernel with notebooks_kernel and diagnose again to confirm.",
		input: z.object({ notebook_id: NOTEBOOK_ID }),
		async execute(input, context) {
			const session = await open(input.notebook_id, context);
			const [runtime, dependencyStatus] = await Promise.allSettled([
				session.getRuntimeStatus(),
				session.getDependencyStatus(),
			]);
			const errorMessage = (reason: unknown) =>
				reason instanceof Error ? reason.message : String(reason);
			const kernelError = runtime.status === "fulfilled" ? kernelErrorOf(runtime.value) : undefined;
			const pendingApproval =
				dependencyStatus.status === "fulfilled"
					? pendingApprovalLabels(dependencyTrust(dependencyStatus.value))
					: [];
			const summary =
				runtime.status === "fulfilled"
					? summarizeKernelState(runtime.value, kernelError, pendingApproval)
					: `Kernel status is unavailable: ${errorMessage(runtime.reason)}`;
			const kernelState =
				runtime.status === "fulfilled"
					? {
							lifecycle: runtime.value.lifecycle,
							status: runtime.value.status,
							...(runtime.value.activity ? { activity: runtime.value.activity } : {}),
							starting_phase: runtime.value.startingPhase,
							env_source: runtime.value.envSource,
							name: runtime.value.name,
							language: runtime.value.language,
						}
					: null;
			return toolResult(
				JSON.stringify({
					notebook_id: input.notebook_id,
					summary,
					kernel_error: kernelError ?? null,
					kernel: kernelState,
					...(dependencyStatus.status === "fulfilled"
						? {
								dependencies: dependencyStatus.value,
								...approvalReport(dependencyStatus.value),
								typosquat_warnings: checkTyposquats(
									declaredDependencySpecs(dependencyStatus.value),
								),
							}
						: { dependencies_error: errorMessage(dependencyStatus.reason) }),
				}),
				{
					title: kernelError ? "Notebook error diagnosed" : "Notebook diagnosed",
					notebook_id: input.notebook_id,
					has_error: Boolean(kernelError) || kernelState?.lifecycle === "Error",
				},
			);
		},
	});

	const kernel = defineTool({
		name: "notebooks_kernel",
		description:
			"Inspect, interrupt, or restart the kernel for an open notebook. To find out why a kernel " +
			"failed to start, use notebooks_diagnose.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			action: z.enum(["status", "interrupt", "restart"]),
		}),
		async execute(input, context) {
			const session = await open(input.notebook_id, context);
			if (input.action === "interrupt") await session.interruptKernel();
			if (input.action === "restart") {
				await requireExecutionApproval(permission, context, input.notebook_id, {
					kind: "restart",
				});
				await session.restartKernel();
			}
			const status = await session.getRuntimeStatus();
			return toolResult(
				JSON.stringify({ notebook_id: input.notebook_id, action: input.action, status }),
				{ title: "Notebook kernel", notebook_id: input.notebook_id, action: input.action },
			);
		},
	});

	const save = defineTool({
		name: "notebooks_save",
		description:
			"Save an open notebook, optionally to an .ipynb path. Paths outside the Kilo workspace require user approval.",
		input: z.object({
			notebook_id: NOTEBOOK_ID,
			path: z.string().min(1).optional(),
		}),
		async execute(input, context) {
			const session = await open(input.notebook_id, context);
			if (!input.path) {
				await session.saveNotebook();
				return toolResult("Saved to the notebook's current path.", {
					title: "Notebook saved",
					notebook_id: input.notebook_id,
				});
			}

			const targetPath = path.resolve(directory, input.path);
			if (path.extname(targetPath).toLowerCase() !== ".ipynb") {
				throw new Error("Notebook save paths must end in .ipynb.");
			}
			const relativePath = path.relative(directory, targetPath);
			const isInsideWorkspace =
				relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
			if (!isInsideWorkspace) {
				const resource = externalDirectoryResource(targetPath);
				await assertForCall(permission, context, {
					action: "external_directory",
					resources: [resource],
					save: [resource],
					metadata: { notebook_id: input.notebook_id, path: targetPath },
				});
			}
			await session.saveNotebook(targetPath);
			return toolResult(targetPath, {
				title: "Notebook saved",
				notebook_id: input.notebook_id,
				path: targetPath,
			});
		},
	});

	return [read, runCell, createCell, editCells, execute, dependencies, diagnose, kernel, save];
}

/** Releases a deleted chat's notebook peers until `signal` aborts. */
async function closeSessionsOnDelete(
	ctx: PluginContext,
	sessions: NotebookSessionRegistry,
	signal: AbortSignal,
): Promise<void> {
	for await (const event of ctx.event.subscribe({ types: ["session.deleted"], signal })) {
		if (signal.aborted) break;
		const sessionId = (event.data as { sessionID?: unknown } | undefined)?.sessionID;
		if (typeof sessionId === "string") await sessions.closeForKiloSession(sessionId);
	}
}

export function createNteractKiloPlugin(dependencies: PluginDependencies = {}) {
	return {
		id: "anaconda-notebooks",
		/** Runs once per Kilo location; the returned cleanup closes its notebook peers. */
		async setup(ctx: PluginContext): Promise<() => Promise<void>> {
			const runtimed = requireRuntimedNode(
				(dependencies.loadRuntimedNode ?? defaultLoadRuntimedNode)(),
			);
			const sessions = new NotebookSessionRegistry(runtimed);
			const tools = notebookTools(ctx, runtimed, sessions);
			await ctx.tool.transform((editor) => {
				for (const tool of tools) editor.add(tool);
			});
			await ctx.agent.transform((editor) => {
				for (const agent of editor.list()) {
					editor.update(agent.id, (info) => requireNotebookPrompts(info.permissions));
				}
			});
			const stop = new AbortController();
			// Session cleanup is best effort: a failed subscription must not fail the plugin.
			void closeSessionsOnDelete(ctx, sessions, stop.signal).catch(() => undefined);
			return async () => {
				stop.abort();
				await sessions.closeAll();
			};
		},
	};
}

export default createNteractKiloPlugin();
