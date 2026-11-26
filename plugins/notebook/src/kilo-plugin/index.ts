import { readlink, realpath, stat } from "node:fs/promises";
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
	withTrustGuidance,
} from "./dependency-approval";
import { EXECUTE_PERMISSION, requireExecutionApproval } from "./execution-approval";

type ToolAttachment = {
	type: "file";
	mime: string;
	uri: string;
	name?: string;
};

/** What a permission check asks Kilo for (v2's `permission.assert`, bound to the call). */
type PermissionCheck = {
	action: string;
	resources: string[];
	save: string[];
	metadata: Record<string, unknown>;
};

/** What each notebook tool gets per call: the Kilo session, its workspace and the call's permission check. */
type CallContext = {
	readonly sessionID: string;
	readonly signal: AbortSignal;
	/** The Kilo location's directory. */
	readonly directory: string;
	/** The location's project root (a worktree's root, or the directory outside VCS). */
	readonly worktree: string;
	assert(input: PermissionCheck): Promise<void>;
};

/** A notebook tool's answer, before it becomes Kilo's `Tool.Result` (see `toolResult`). */
type ToolOutput = {
	title?: string;
	output: string;
	metadata?: Record<string, unknown>;
	attachments?: ToolAttachment[];
};

type ToolDefinition<TArgs> = {
	description: string;
	args: z.ZodRawShape;
	execute(args: TArgs, context: CallContext): Promise<ToolOutput>;
};

/** The parts of Kilo v2's promise plugin context (`@opencode/plugin`) this plugin uses. */
export interface KiloPluginContext {
	readonly location: {
		readonly directory: string;
		readonly project: { readonly directory: string };
	};
	readonly tool: {
		transform(callback: (tools: { add(tool: KiloTool): void }) => void): Promise<unknown>;
	};
	readonly permission: {
		hook(
			name: "evaluate",
			callback: (event: PermissionEvaluation) => void | Promise<void>,
		): Promise<unknown>;
		assert(input: {
			sessionID: string;
			agent?: string;
			action: string;
			resources: string[];
			save?: string[];
			metadata?: Record<string, unknown>;
			source?: { type: "tool"; messageID: string; id: string };
		}): Promise<void>;
	};
	readonly event: {
		subscribe(options: {
			types: ["session.deleted"];
			signal: AbortSignal;
		}): AsyncIterable<{ type: string; data?: { sessionID?: string } }>;
	};
}

/** A tool as Kilo v2 registers it (`Tool.Info` with a Standard Schema input). */
export interface KiloTool {
	readonly name: string;
	readonly description: string;
	readonly input: z.ZodType;
	readonly options: { readonly codemode: false };
	execute(input: unknown, context: KiloToolContext): Promise<KiloToolResult>;
}

export interface KiloToolContext {
	readonly sessionID: string;
	readonly agent: string;
	readonly messageID: string;
	readonly id: string;
	readonly signal: AbortSignal;
}

export type KiloToolResult = {
	content: string | Array<{ type: "text"; text: string } | ToolAttachment>;
	metadata?: Record<string, unknown>;
};

export interface PermissionEvaluation {
	readonly action: string;
	readonly resources: ReadonlyArray<string>;
	effect: "allow" | "deny" | "ask";
	/** The rules Kilo evaluated, user and saved "Always allow" rules last (a Kilo seam). */
	readonly rules?: ReadonlyArray<{ action: string; resource: string; effect: string }>;
}

type RuntimedNode = {
	openNotebook(
		notebookId: string,
		options?: { socketPath?: string; peerLabel?: string; description?: string },
	): Promise<Session>;
	getExecutionResult?(executionId: string): Promise<CellResult>;
	listActiveNotebooks?(): Promise<{ notebookId: string; notebookPath?: string }[]>;
};

type PluginDependencies = {
	loadRuntimedNode?: () => unknown;
};

const OPEN_FILE_TOOL = "desktop_notebook_open_file";
const LIST_OPEN_TOOL = "desktop_notebook_list_open";
const NOTEBOOK_ID_DESCRIPTION = `Notebook UUID from ${LIST_OPEN_TOOL}, desktop_notebook_open, or ${OPEN_FILE_TOOL}. Not a file name or path; open .ipynb files with ${OPEN_FILE_TOOL} first.`;
const NOTEBOOK_UUID = z.string().uuid();
/**
 * Tool inputs take any string: Kilo validates inputs before a tool runs, and a
 * UUID schema would refuse a notebook's file name with a generic message
 * instead of `assertNotebookUuid`'s exact open_file call. The description
 * carries the contract.
 */
const NOTEBOOK_ID = z.string().min(1).describe(NOTEBOOK_ID_DESCRIPTION);
const NOTEBOOK_PEER_LABEL = "Kilo Desktop";

type SessionContext = Pick<CallContext, "sessionID" | "directory" | "worktree" | "assert">;
type WorkspaceContext = Pick<CallContext, "directory" | "worktree">;

function isInside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
}

const MAX_SYMLINK_HOPS = 40;

/**
 * Follows symlinks in `target`, which need not exist yet: a missing part is
 * kept as written, and a symlink whose target is missing is followed to it.
 */
function canonicalPath(target: string): Promise<string> {
	return followLinks(target, 0);
}

async function followLinks(target: string, hops: number): Promise<string> {
	const missing: string[] = [];
	let existing = target;
	for (;;) {
		try {
			return path.join(await realpath(existing), ...missing);
		} catch {
			const link = await readlink(existing).catch(() => null);
			if (link !== null && hops < MAX_SYMLINK_HOPS) {
				const linked = path.resolve(path.dirname(existing), link);
				return followLinks(path.join(linked, ...missing), hops + 1);
			}
			const parent = path.dirname(existing);
			if (parent === existing) return target;
			missing.unshift(path.basename(existing));
			existing = parent;
		}
	}
}

/** Kilo treats a session's directory and its worktree as the workspace, except a filesystem-root worktree. */
async function isInsideWorkspace(target: string, context: WorkspaceContext): Promise<boolean> {
	const roots = [context.directory, context.worktree].filter((root) => path.dirname(root) !== root);
	const canonicalRoots = await Promise.all(roots.map(canonicalPath));
	return canonicalRoots.some((root) => isInside(root, target));
}

/** Canonical path of an existing `.ipynb` file inside the workspace, after following symlinks. */
async function workspaceNotebookPath(name: string, worktree: string): Promise<string | null> {
	if (path.extname(name).toLowerCase() !== ".ipynb") return null;
	try {
		const [root, target] = await Promise.all([
			realpath(worktree),
			realpath(path.resolve(worktree, name)),
		]);
		if (target === root || !isInside(root, target)) return null;
		return (await stat(target)).isFile() ? target : null;
	} catch {
		return null;
	}
}

/**
 * The daemon reads any non-UUID notebook id as a file path. Tools therefore address notebooks
 * only by the UUID the chat pane reports, which keeps every notebook an agent
 * edits visible to the user. A workspace notebook name is answered with the
 * exact open_file call rather than opened out of view.
 */
async function assertNotebookUuid(notebookId: string, worktree: string): Promise<void> {
	if (NOTEBOOK_UUID.safeParse(notebookId).success) return;
	const notebookPath = await workspaceNotebookPath(notebookId, worktree);
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
 *
 * A notebook whose file lies outside the Kilo workspace is opened only after
 * Kilo's `external_directory` permission allows its folder, as Kilo's own file
 * tools do. The answer is remembered per Kilo session and file location, so
 * "Allow once" covers the rest of that session rather than a single call.
 */
class NotebookSessionRegistry {
	readonly #runtimed: RuntimedNode;
	readonly #sessions = new Map<string, Promise<Session>>();
	readonly #statusSubscriptions = new Map<string, StatusSubscription>();
	readonly #disconnected = new WeakSet<Session>();
	readonly #notebooksByKiloSession = new Map<string, Set<string>>();
	readonly #allowedLocationsByKiloSession = new Map<string, Set<string>>();

	constructor(runtimed: RuntimedNode) {
		this.#runtimed = runtimed;
	}

	async open(notebookId: string, context: SessionContext): Promise<Session> {
		await assertNotebookUuid(notebookId, context.worktree);
		await this.#allowLocation(notebookId, context);
		const owned = this.#notebooksByKiloSession.get(context.sessionID) ?? new Set<string>();
		owned.add(notebookId);
		this.#notebooksByKiloSession.set(context.sessionID, owned);

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

	async #allowLocation(notebookId: string, context: SessionContext): Promise<void> {
		const active = await this.#runtimed.listActiveNotebooks?.();
		const notebookPath = active?.find(
			(notebook) => notebook.notebookId === notebookId,
		)?.notebookPath;
		if (!notebookPath) return;
		const filepath = await canonicalPath(notebookPath);
		if (await isInsideWorkspace(filepath, context)) return;

		if (this.isLocationAllowed(context.sessionID, filepath)) return;
		const parentDir = path.dirname(filepath);
		const pattern = path.join(parentDir, "*");
		await context.assert({
			action: "external_directory",
			resources: [pattern],
			save: [pattern],
			metadata: {
				toolName: "Notebook outside workspace",
				title: "Use a notebook outside this workspace?",
				description: `The agent wants to read or change ${filepath}, which is outside this chat's workspace.`,
				filepath,
				parentDir,
				notebook_id: notebookId,
			},
		});
		this.allowLocation(context.sessionID, filepath);
	}

	isLocationAllowed(kiloSessionId: string, filepath: string): boolean {
		return this.#allowedLocationsByKiloSession.get(kiloSessionId)?.has(filepath) ?? false;
	}

	allowLocation(kiloSessionId: string, filepath: string): void {
		const allowed = this.#allowedLocationsByKiloSession.get(kiloSessionId) ?? new Set<string>();
		allowed.add(filepath);
		this.#allowedLocationsByKiloSession.set(kiloSessionId, allowed);
	}

	async closeForKiloSession(kiloSessionId: string): Promise<void> {
		this.#allowedLocationsByKiloSession.delete(kiloSessionId);
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

function projectCellResult(result: CellResult): ToolOutput {
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
					attachments.push({ type: "file", mime, uri: `data:${mime};base64,${value}` });
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

const TRUST_PERMISSION = "notebooks_trust";

const PROMPTED_PERMISSIONS = [TRUST_PERMISSION, EXECUTE_PERMISSION];

/**
 * Kilo v2's `Wildcard.match` (`packages/core/src/util/wildcard.ts`): `*` is any
 * run, `?` one character, and a trailing ` *` is optional.
 */
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

/**
 * Kilo's built-in agents allow every action (`{ action: "*", effect: "allow" }`),
 * so dependency approvals and notebook code execution would otherwise proceed
 * without the user ever seeing them. Kilo v2 has no config hook to change the
 * defaults, so its `permission.evaluate` hook turns such an allow into an ask.
 *
 * An allow stands only when the last rule matching every resource names the
 * action itself: a user's own `notebooks_execute` rule, or the per-pattern rule
 * Kilo saves for "Always allow". Kilo applies the last matching rule, and saved
 * rules come last. Without Kilo's evaluated rules on the event, every allow
 * asks.
 */
export function requireNotebookPrompt(event: PermissionEvaluation): void {
	if (!PROMPTED_PERMISSIONS.includes(event.action) || event.effect !== "allow") return;
	const rules = event.rules ?? [];
	const chosen = event.resources.every((resource) => {
		const rule = rules.findLast(
			(candidate) =>
				wildcardMatch(event.action, candidate.action) &&
				wildcardMatch(resource, candidate.resource),
		);
		return rule?.effect === "allow" && rule.action !== "*";
	});
	if (!chosen) event.effect = "ask";
}

type DependencyStatus = Awaited<ReturnType<Session["getDependencyStatus"]>>;

/** Agent-facing view of what is waiting for approval; omitted when nothing is. */
function approvalReport(status: DependencyStatus) {
	const trust = dependencyTrust(status);
	return trust.needsApproval
		? { approval: { needs_approval: true, unapproved: pendingApprovalLabels(trust) } }
		: {};
}

type EditOperation =
	| {
			action: "update";
			cell_id: string;
			source?: string;
			cell_type?: "code" | "markdown" | "raw";
	  }
	| { action: "delete"; cell_id: string }
	| { action: "move"; cell_id: string; after_cell_id?: string | null };

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

/** Kilo's `Tool.Result`: text, plus a file part per image; the title rides in metadata. */
function toolResult({ title, output, metadata, attachments }: ToolOutput): KiloToolResult {
	return {
		content: attachments?.length ? [{ type: "text", text: output }, ...attachments] : output,
		metadata: { ...(title ? { title } : {}), ...metadata },
	};
}

/**
 * The notebook tools as a Kilo v2 server plugin (`{ id, setup }`), one
 * instance per Kilo location. Each tool runs with the call's Kilo session, the
 * location's folder and project root as its workspace, and permission checks
 * bound to the call (`permission.assert`, which prompts and waits). Peers a
 * deleted session no longer needs are released on `session.deleted`.
 */
export function createNteractKiloPlugin(dependencies: PluginDependencies = {}) {
	return {
		id: "anaconda-notebooks",
		setup: async (ctx: KiloPluginContext) => {
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
					const session = await sessions.open(args.notebook_id, context);
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
					if (context.signal.aborted) throw new Error("Notebook execution was cancelled.");
					const session = await sessions.open(args.notebook_id, context);
					await requireExecutionApproval(context, args.notebook_id, {
						kind: "run",
						code: args.code,
					});
					if (args.dependencies?.length) {
						await requireDependencyApproval(context, session, args.notebook_id, {
							kind: "add",
							packages: args.dependencies,
						});
						await session.addDependencies(args.dependencies);
						await withTrustGuidance(session, () => session.syncEnvironment());
					}
					const result = await withTrustGuidance(session, () =>
						session.runCell(args.code, {
							timeoutMs: Math.round((args.timeout_secs ?? 120) * 1000),
						}),
					);
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
					if (context.signal.aborted) throw new Error("Notebook cell creation was cancelled.");
					const session = await sessions.open(args.notebook_id, context);
					const cellType = args.cell_type ?? "code";
					const runAfterCreate = Boolean(args.and_run) && cellType === "code";
					await assertAnchorExists(session, args.after_cell_id);
					if (runAfterCreate) {
						await requireExecutionApproval(context, args.notebook_id, {
							kind: "run",
							code: args.source ?? "",
						});
					}
					const cellId = await session.createCell(args.source ?? "", {
						cellType,
						...(args.after_cell_id === null ? { index: 0 } : {}),
						...(typeof args.after_cell_id === "string" ? { afterCellId: args.after_cell_id } : {}),
					});
					sessions.assertConnected(session);
					if (runAfterCreate) {
						const result = await withTrustGuidance(session, () =>
							session.executeCell(cellId, {
								timeoutMs: Math.round((args.timeout_secs ?? 120) * 1000),
							}),
						);
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

			const editCells: ToolDefinition<{
				notebook_id: string;
				operations: EditOperation[];
			}> = {
				description:
					"Apply an ordered batch of updates, moves, and deletes to existing notebook cells.",
				args: {
					notebook_id: NOTEBOOK_ID,
					// Strict objects so a misspelled key (e.g. "sourc") fails validation
					// instead of being stripped into a silent no-op update.
					operations: z
						.array(
							z.discriminatedUnion("action", [
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
							]),
						)
						.min(1)
						.max(100),
				},
				async execute(args, context) {
					args.operations.forEach((operation, index) => {
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

					const session = await sessions.open(args.notebook_id, context);
					const results: Array<Record<string, unknown>> = [];
					const failAt = (index: number, operation: EditOperation, reason: string): never => {
						throw new Error(
							`Operation ${index + 1} (${operation.action} ${operation.cell_id}) failed: ${reason}. ` +
								`Applied before the failure: ${JSON.stringify(results)}. Re-read the notebook before retrying.`,
						);
					};
					for (const [index, operation] of args.operations.entries()) {
						if (context.signal.aborted) failAt(index, operation, "the edit was cancelled");
						let result: Record<string, unknown> | null;
						try {
							// Edits apply in the caller's order and stop at the first failure.
							// react-doctor-disable-next-line react-doctor/async-await-in-loop
							result = await applyEditOperation(session, operation);
						} catch (error) {
							return failAt(
								index,
								operation,
								error instanceof Error ? error.message : String(error),
							);
						}
						if (!result) failAt(index, operation, "cell not found");
						results.push({ action: operation.action, cell_id: operation.cell_id, ...result });
					}
					sessions.assertConnected(session);
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
					const session = await sessions.open(args.notebook_id, context);
					const cells = await session.listCells();
					const cellIds =
						args.cell_ids ??
						cells.filter((cell) => cell.cellType === "code").map((cell) => cell.id);
					if (cellIds.length > 0) {
						await requireExecutionApproval(context, args.notebook_id, {
							kind: "execute",
							cellIds,
							cellNumbers: cellNumbersOf(cells, cellIds),
							allCells: args.cell_ids === undefined,
						});
					}
					const results: CellResult[] = [];
					for (const cellId of cellIds) {
						if (context.signal.aborted) throw new Error("Notebook execution was cancelled.");
						const result = await withTrustGuidance(session, () =>
							session.executeCell(cellId, {
								timeoutMs: Math.round((args.timeout_secs ?? 120) * 1000),
							}),
						);
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
			}> = {
				description:
					"Inspect or update the notebook environment. Add and remove synchronize immediately. " +
					"Adding, removing, or approving asks the user first whenever it would approve packages " +
					"the machine has not approved yet, including dependencies the notebook already declares; " +
					"suspected typosquats are flagged in that prompt. Status reports what is waiting for approval.",
				args: {
					notebook_id: NOTEBOOK_ID,
					action: z.enum(["status", "add", "remove", "sync", "approve_trust"]),
					packages: z.array(z.string().min(1)).min(1).max(100).optional(),
					package_manager: z.enum(["uv", "conda", "pixi"]).optional(),
				},
				async execute(args, context) {
					if ((args.action === "add" || args.action === "remove") && !args.packages?.length) {
						throw new Error(`packages is required for action ${args.action}.`);
					}
					const packages = args.packages ?? [];
					const session = await sessions.open(args.notebook_id, context);
					const editOptions = args.package_manager
						? { packageManager: args.package_manager }
						: undefined;
					const syncEnvironment = () => withTrustGuidance(session, () => session.syncEnvironment());
					switch (args.action) {
						case "add":
							await requireDependencyApproval(context, session, args.notebook_id, {
								kind: "add",
								packages,
							});
							await session.addDependencies(packages, editOptions);
							await syncEnvironment();
							break;
						case "remove":
							await requireDependencyApproval(context, session, args.notebook_id, {
								kind: "remove",
								packages,
							});
							await session.removeDependencies(packages, editOptions);
							await syncEnvironment();
							break;
						case "sync":
							await syncEnvironment();
							break;
						case "approve_trust":
							if (
								await requireDependencyApproval(context, session, args.notebook_id, {
									kind: "approve",
								})
							) {
								await session.approveTrust(undefined);
							}
							break;
						case "status":
							break;
					}
					const [status, kernelError] = await Promise.all([
						session.getDependencyStatus(),
						readKernelError(session),
					]);
					const typosquatWarnings = checkTyposquats(declaredDependencySpecs(status));
					return {
						title: "Notebook dependencies",
						output: JSON.stringify({
							notebook_id: args.notebook_id,
							action: args.action,
							status,
							...approvalReport(status),
							...(kernelError ? { kernel_error: kernelError } : {}),
							...(typosquatWarnings.length ? { typosquat_warnings: typosquatWarnings } : {}),
						}),
						metadata: { notebook_id: args.notebook_id, action: args.action },
					};
				},
			};

			const diagnose: ToolDefinition<{ notebook_id: string }> = {
				description:
					"Diagnose why a notebook is broken: kernel failed to start, environment or conda/uv/pixi " +
					"install errors, environment.yml problems, missing ipykernel, pending dependency trust, or " +
					"dependency names that look like typosquats of popular packages. " +
					"Returns the exact kernel error the user sees in the notebook, plus kernel state and " +
					"dependency metadata. Use this first when the user reports a notebook error or asks what went " +
					"wrong. Get notebook_id from desktop_notebook_list_open. After fixing the cause, restart the " +
					"kernel with notebooks_kernel and diagnose again to confirm.",
				args: { notebook_id: NOTEBOOK_ID },
				async execute(args, context) {
					const session = await sessions.open(args.notebook_id, context);
					const [runtime, dependencies] = await Promise.allSettled([
						session.getRuntimeStatus(),
						session.getDependencyStatus(),
					]);
					const errorMessage = (reason: unknown) =>
						reason instanceof Error ? reason.message : String(reason);
					const kernelError =
						runtime.status === "fulfilled" ? kernelErrorOf(runtime.value) : undefined;
					const pendingApproval =
						dependencies.status === "fulfilled"
							? pendingApprovalLabels(dependencyTrust(dependencies.value))
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
					return {
						title: kernelError ? "Notebook error diagnosed" : "Notebook diagnosed",
						output: JSON.stringify({
							notebook_id: args.notebook_id,
							summary,
							kernel_error: kernelError ?? null,
							kernel: kernelState,
							...(dependencies.status === "fulfilled"
								? {
										dependencies: dependencies.value,
										...approvalReport(dependencies.value),
										typosquat_warnings: checkTyposquats(
											declaredDependencySpecs(dependencies.value),
										),
									}
								: { dependencies_error: errorMessage(dependencies.reason) }),
						}),
						metadata: {
							notebook_id: args.notebook_id,
							has_error: Boolean(kernelError) || kernelState?.lifecycle === "Error",
						},
					};
				},
			};

			const kernel: ToolDefinition<{
				notebook_id: string;
				action: "status" | "interrupt" | "restart";
			}> = {
				description:
					"Inspect, interrupt, or restart the kernel for an open notebook. To find out why a kernel " +
					"failed to start, use notebooks_diagnose.",
				args: {
					notebook_id: NOTEBOOK_ID,
					action: z.enum(["status", "interrupt", "restart"]),
				},
				async execute(args, context) {
					const session = await sessions.open(args.notebook_id, context);
					if (args.action === "interrupt") await session.interruptKernel();
					if (args.action === "restart") {
						await requireExecutionApproval(context, args.notebook_id, { kind: "restart" });
						await session.restartKernel();
					}
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
					const session = await sessions.open(args.notebook_id, context);
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
					const canonicalTarget = await canonicalPath(targetPath);
					if (
						!(await isInsideWorkspace(canonicalTarget, context)) &&
						!sessions.isLocationAllowed(context.sessionID, canonicalTarget)
					) {
						await context.assert({
							action: "external_directory",
							resources: [canonicalTarget],
							save: [],
							metadata: { notebook_id: args.notebook_id, path: canonicalTarget },
						});
						sessions.allowLocation(context.sessionID, canonicalTarget);
					}
					await session.saveNotebook(targetPath);
					return {
						title: "Notebook saved",
						output: targetPath,
						metadata: { notebook_id: args.notebook_id, path: targetPath },
					};
				},
			};

			const tools: Record<string, ToolDefinition<never>> = {
				notebooks_create_cell: createCell,
				notebooks_dependencies: dependenciesTool,
				notebooks_diagnose: diagnose,
				notebooks_edit_cells: editCells,
				notebooks_execute: execute,
				notebooks_kernel: kernel,
				notebooks_read: read,
				notebooks_run_cell: runCell,
				notebooks_save: save,
			} as never;
			const workspace = {
				directory: ctx.location.directory,
				worktree: ctx.location.project.directory,
			};
			const callContext = (call: KiloToolContext): CallContext => ({
				sessionID: call.sessionID,
				signal: call.signal,
				...workspace,
				assert: ({ action, resources, save, metadata }) =>
					ctx.permission.assert({
						sessionID: call.sessionID,
						agent: call.agent,
						action,
						resources,
						save,
						metadata,
						source: { type: "tool", messageID: call.messageID, id: call.id },
					}),
			});
			await ctx.tool.transform((editor) => {
				for (const [name, tool] of Object.entries(tools)) {
					editor.add({
						name,
						description: tool.description,
						input: z.object(tool.args),
						// Desktop's renderers and permission cards key on these names.
						options: { codemode: false },
						execute: async (input, call) =>
							toolResult(await tool.execute(input as never, callContext(call))),
					});
				}
			});
			await ctx.permission.hook("evaluate", requireNotebookPrompt);

			const released = new AbortController();
			void (async () => {
				for await (const event of ctx.event.subscribe({
					types: ["session.deleted"],
					signal: released.signal,
				})) {
					const sessionId = event.data?.sessionID;
					if (event.type === "session.deleted" && typeof sessionId === "string") {
						await sessions.closeForKiloSession(sessionId);
					}
				}
			})().catch(() => undefined);
			return () => released.abort();
		},
	};
}

export default createNteractKiloPlugin();
