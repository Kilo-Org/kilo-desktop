/**
 * What a team member is doing, read from its chat's messages as Kilo serves
 * them (`session.messages`): the task it was delegated, its newest tool
 * calls, and the files it changed. Pure and tolerant of missing fields: the
 * messages come straight off the wire, and older Kilo versions omit some.
 */

/** One tool call, as the Members tab lists it. */
export interface AgentStep {
	readonly id: string;
	/** Display name: "Bash", "Edit", "Read", "Grep"… */
	readonly tool: string;
	/** The command, file path or pattern, short. */
	readonly label: string;
	readonly status: "running" | "completed" | "error";
	/** "+38 −12" for an edit, "5 files" for a glob…, only when the call reports it. */
	readonly detail?: string;
}

export interface AgentActivity {
	/** The agent's first (delegated) user message. */
	readonly task?: string;
	/** The newest tool calls, oldest first, at most 3. */
	readonly steps: readonly AgentStep[];
	/** What it is doing now: the running step, else the newest one ("Bash · pnpm test"). */
	readonly now?: string;
	/** Its newest tool call is a board post still being written. */
	readonly writingToBoard: boolean;
	/** Distinct files it edited or wrote, oldest first. */
	readonly editedFiles: readonly string[];
}

/** The part of Kilo's `{ info, parts }` message the activity reads. */
export interface SessionMessageLike {
	readonly info?: {
		readonly role?: string;
		readonly time?: { readonly created?: number };
	};
	readonly parts?: readonly unknown[];
}

const RECENT_STEPS = 3;
const MAX_LABEL = 120;

const BOARD_POST_TOOLS = new Set(["board_post", "board_write"]);
const EDIT_TOOLS = new Set(["edit", "multiedit", "write", "apply_patch", "patch", "notebook_edit"]);
const FILE_TOOLS = new Set([
	"edit",
	"multiedit",
	"write",
	"read",
	"notebook_edit",
	"notebook_read",
]);
/** Bookkeeping calls that say nothing about the work. */
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"]);

const TOOL_NAMES: Readonly<Record<string, string>> = {
	bash: "Bash",
	edit: "Edit",
	multiedit: "Edit",
	write: "Write",
	read: "Read",
	grep: "Grep",
	glob: "Glob",
	list: "List",
	apply_patch: "Patch",
	patch: "Patch",
	notebook_edit: "Edit",
	notebook_read: "Read",
	webfetch: "Fetch",
	websearch: "Web search",
	codebase_search: "Search",
	semantic_search: "Search",
	task: "Delegate",
	skill: "Skill",
	question: "Question",
	board_post: "Board post",
	board_write: "Board post",
	board_read: "Board read",
};

const FILE_PATH_KEYS = ["filePath", "file_path", "path", "file"] as const;

type Rec = Readonly<Record<string, unknown>>;

const record = (value: unknown): Rec | undefined =>
	value && typeof value === "object" ? (value as Rec) : undefined;

const text = (value: unknown): string =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const count = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const short = (value: string): string =>
	value.length > MAX_LABEL ? `${value.slice(0, MAX_LABEL - 1)}…` : value;

const plural = (n: number, singular: string, many = `${singular}s`) =>
	`${n} ${n === 1 ? singular : many}`;

const lineCounts = (added: number, removed: number) => `+${added} −${removed}`;

/** An absolute path without the tool's relative title: its last three segments. */
function shortPath(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return path.startsWith("/") && segments.length > 3 ? `…/${segments.slice(-3).join("/")}` : path;
}

function displayName(tool: string): string {
	const known = TOOL_NAMES[tool.toLowerCase()];
	if (known) return known;
	const words = tool.split(/[-_\s]+/).filter(Boolean);
	const name = words.join(" ");
	return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Tool";
}

interface ToolCall {
	readonly id: string;
	readonly tool: string;
	readonly status: AgentStep["status"];
	readonly input: Rec;
	readonly metadata: Rec;
	readonly title: string;
}

function toolCall(part: unknown, fallbackId: string): ToolCall | undefined {
	const value = record(part);
	if (value?.type !== "tool" || typeof value.tool !== "string" || !value.tool) return undefined;
	const state = record(value.state);
	const status =
		state?.status === "completed" ? "completed" : state?.status === "error" ? "error" : "running";
	const id = [value.id, value.callID].find((candidate) => typeof candidate === "string");
	return {
		id: (id as string | undefined) ?? fallbackId,
		tool: value.tool,
		status,
		input: record(state?.input) ?? {},
		metadata: record(state?.metadata) ?? record(value.metadata) ?? {},
		title: text(state?.title),
	};
}

function inputPath(input: Rec): string {
	for (const key of FILE_PATH_KEYS) {
		const value = text(input[key]);
		if (value) return value;
	}
	return "";
}

/** The files an apply_patch call touched: Kilo's metadata, else the patch's own headers. */
function patchFiles(call: ToolCall): string[] {
	const files = Array.isArray(call.metadata.files) ? call.metadata.files : [];
	const fromMetadata = files.flatMap((file) => {
		const entry = record(file);
		const path = text(entry?.relativePath) || text(entry?.filePath) || text(entry?.path);
		return path ? [path] : [];
	});
	if (fromMetadata.length > 0) return [...new Set(fromMetadata)];
	const patch =
		typeof call.input.patchText === "string"
			? call.input.patchText
			: typeof call.input.patch === "string"
				? call.input.patch
				: "";
	return [
		...new Set(
			[...patch.matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm)].map((match) =>
				match[1]!.trim(),
			),
		),
	];
}

/** A file tool's path: Kilo titles it relative to the worktree once it ran. */
function filePath(call: ToolCall): string {
	const path = inputPath(call.input);
	if (call.title && call.status !== "running") return call.title;
	return path ? shortPath(path) : call.title;
}

function changedFiles(call: ToolCall): string[] {
	const tool = call.tool.toLowerCase();
	if (!EDIT_TOOLS.has(tool)) return [];
	if (tool === "apply_patch" || tool === "patch") return patchFiles(call);
	const path = filePath(call);
	return path ? [path] : [];
}

function label(call: ToolCall): string {
	const tool = call.tool.toLowerCase();
	const { input } = call;
	if (tool === "bash") return text(input.command) || text(input.description) || call.title;
	if (FILE_TOOLS.has(tool)) return filePath(call);
	if (tool === "apply_patch" || tool === "patch") {
		const files = patchFiles(call);
		return files[0] ?? call.title;
	}
	if (tool === "grep" || tool === "glob")
		return text(input.pattern) || text(input.query) || call.title;
	if (tool === "list") return call.title || shortPath(inputPath(input));
	if (tool === "webfetch") return text(input.url) || call.title;
	if (tool === "task") return text(input.description) || text(input.prompt) || call.title;
	if (BOARD_POST_TOOLS.has(tool)) {
		const body = [input.body, input.message, input.content, input.text].find(
			(candidate) => typeof candidate === "string" && candidate.trim(),
		) as string | undefined;
		return text(body?.split("\n").find((line) => line.trim())) || call.title;
	}
	return (
		text(input.query) ||
		text(input.pattern) ||
		text(input.command) ||
		inputPath(input) ||
		text(input.description) ||
		text(input.name) ||
		call.title
	);
}

/** Additions and deletions in a unified diff, without its file headers. */
function diffCounts(diff: string): { added: number; removed: number } | undefined {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return added > 0 || removed > 0 ? { added, removed } : undefined;
}

function editDetail(call: ToolCall): string | undefined {
	const filediff = record(call.metadata.filediff);
	const added = count(filediff?.additions);
	const removed = count(filediff?.deletions);
	if (added !== undefined || removed !== undefined) return lineCounts(added ?? 0, removed ?? 0);
	const counted =
		typeof call.metadata.diff === "string" ? diffCounts(call.metadata.diff) : undefined;
	return counted ? lineCounts(counted.added, counted.removed) : undefined;
}

function patchDetail(call: ToolCall): string | undefined {
	const files = Array.isArray(call.metadata.files) ? call.metadata.files.map(record) : [];
	let added = 0;
	let removed = 0;
	let counted = false;
	for (const file of files) {
		const additions = count(file?.additions);
		const deletions = count(file?.deletions);
		if (additions === undefined && deletions === undefined) continue;
		counted = true;
		added += additions ?? 0;
		removed += deletions ?? 0;
	}
	const fromDiff =
		!counted && typeof call.metadata.diff === "string" ? diffCounts(call.metadata.diff) : undefined;
	const lines = counted
		? lineCounts(added, removed)
		: fromDiff
			? lineCounts(fromDiff.added, fromDiff.removed)
			: undefined;
	const touched = patchFiles(call).length;
	const many = touched > 1 ? plural(touched, "file") : undefined;
	return [many, lines].filter(Boolean).join(" · ") || undefined;
}

function detail(call: ToolCall): string | undefined {
	if (call.status !== "completed") return undefined;
	const tool = call.tool.toLowerCase();
	const { metadata } = call;
	if (tool === "edit" || tool === "multiedit" || tool === "write" || tool === "notebook_edit")
		return editDetail(call);
	if (tool === "apply_patch" || tool === "patch") return patchDetail(call);
	if (tool === "glob" || tool === "list") {
		const files = count(metadata.count);
		return files === undefined ? undefined : plural(files, "file");
	}
	if (tool === "grep") {
		const matches = count(metadata.matches);
		return matches === undefined ? undefined : plural(matches, "match", "matches");
	}
	if (tool === "read" && Array.isArray(metadata.loaded) && metadata.loaded.length > 1)
		return plural(metadata.loaded.length, "file");
	if (tool === "bash") {
		const exit = metadata.exit ?? metadata.exitCode;
		return typeof exit === "number" && exit !== 0 ? `exit ${exit}` : undefined;
	}
	return undefined;
}

function step(call: ToolCall): AgentStep {
	const extra = detail(call);
	return {
		id: call.id,
		tool: displayName(call.tool),
		label: short(label(call)),
		status: call.status,
		...(extra ? { detail: extra } : {}),
	};
}

const createdAt = (message: SessionMessageLike) => {
	const created = message.info?.time?.created;
	return typeof created === "number" ? created : Number.POSITIVE_INFINITY;
};

/** Oldest first; messages without a time keep their place after the timed ones. */
const chronological = (messages: readonly SessionMessageLike[]) =>
	messages
		.map((message, index) => ({ message, index }))
		.toSorted((a, b) => createdAt(a.message) - createdAt(b.message) || a.index - b.index)
		.map(({ message }) => message);

function taskOf(messages: readonly SessionMessageLike[]): string | undefined {
	for (const message of messages) {
		if (message.info?.role !== "user") continue;
		const words = (message.parts ?? [])
			.flatMap((part) => {
				const value = record(part);
				return value?.type === "text" && !value.synthetic && !value.ignored
					? [typeof value.text === "string" ? value.text.trim() : ""]
					: [];
			})
			.filter(Boolean)
			.join("\n\n");
		if (words) return words;
	}
	return undefined;
}

const nowLine = (current: AgentStep) =>
	current.label ? `${current.tool} · ${current.label}` : current.tool;

export function agentActivityOf(messages: readonly SessionMessageLike[]): AgentActivity {
	const ordered = chronological(Array.isArray(messages) ? messages : []);
	const calls = ordered.flatMap((message, messageIndex) =>
		(Array.isArray(message.parts) ? message.parts : []).flatMap((part, partIndex) => {
			const call = toolCall(part, `tool-${messageIndex}-${partIndex}`);
			return call ? [call] : [];
		}),
	);
	const visible = calls.filter((call) => !HIDDEN_TOOLS.has(call.tool.toLowerCase()));
	const newest = calls.at(-1);
	const running = visible.findLast((call) => call.status === "running");
	const current = running ?? visible.at(-1);
	const task = taskOf(ordered);
	return {
		...(task ? { task } : {}),
		steps: visible.slice(-RECENT_STEPS).map(step),
		...(current ? { now: nowLine(step(current)) } : {}),
		writingToBoard:
			newest !== undefined &&
			newest.status === "running" &&
			BOARD_POST_TOOLS.has(newest.tool.toLowerCase()),
		editedFiles: [
			...new Set(
				calls.filter((call) => call.status === "completed").flatMap((call) => changedFiles(call)),
			),
		],
	};
}
