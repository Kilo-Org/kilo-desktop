import type { LucideIcon } from "lucide-react";
import {
	BookOpenIcon,
	BotIcon,
	BrainIcon,
	CircleHelpIcon,
	FilePenIcon,
	FilePlusIcon,
	GlobeIcon,
	LightbulbIcon,
	ListTodoIcon,
	NotebookIcon,
	SearchIcon,
	SparklesIcon,
	TerminalIcon,
	WrenchIcon,
} from "lucide-react";
import {
	basename,
	getCommandSummary,
	getPatchInfo,
	isCancelledToolStatus,
	isTaskErrorOutput,
	parseBashResult,
	resultText,
	str,
	truncate,
	unwrapTaskOutput,
} from "./tool-ui-shared.js";

/**
 * Tool grouping for the activity view. Categories mirror the built-in tool
 * set of Kilo (the opencode fork used as the backend). MCP tools are named
 * `{server}_{tool}` and group by server; anything else unmapped lands in the
 * generic tools group. Known MCP servers can override their display label and
 * icon (e.g. notebooks → Notebooks, matching the chat notebook pane).
 */

export type ToolCategory =
	| "editing"
	| "writing"
	| "reading"
	| "searching"
	| "web"
	| "terminal"
	| "planning"
	| "asking"
	| "suggesting"
	| "skill"
	| "subagent";

/** Dynamic subgroup for an MCP server, e.g. `mcp:atlassian`. */
export type McpActivityKind = `mcp:${string}`;

export type ActivityKind = ToolCategory | "tools" | "thinking" | McpActivityKind;

const TOOL_CATEGORY_BY_NAME: Record<string, ToolCategory> = {
	edit: "editing",
	apply_patch: "editing",
	notebook_edit: "editing",
	write: "writing",
	read: "reading",
	notebook_read: "reading",
	grep: "searching",
	glob: "searching",
	list: "searching",
	codebase_search: "searching",
	semantic_search: "searching",
	webfetch: "web",
	websearch: "web",
	bash: "terminal",
	interactive_terminal: "terminal",
	background_process: "terminal",
	todowrite: "planning",
	todoread: "planning",
	plan_exit: "planning",
	question: "asking",
	ask_question: "asking",
	request_user_input: "asking",
	requestuserinput: "asking",
	suggest: "suggesting",
	skill: "skill",
	task: "subagent",
};

export const getToolCategory = (toolName: string): ToolCategory | undefined =>
	TOOL_CATEGORY_BY_NAME[toolName.toLowerCase()];

export const isAskQuestionTool = (toolName: string): boolean =>
	getToolCategory(toolName) === "asking";

export const isSuggestTool = (toolName: string): boolean =>
	getToolCategory(toolName) === "suggesting";

export const isSkillTool = (toolName: string): boolean => getToolCategory(toolName) === "skill";

export const isTaskTool = (toolName: string): boolean => getToolCategory(toolName) === "subagent";

/**
 * OpenCode/Kilo MCP tools are named `{server}_{toolName}`. Built-in tools with
 * underscores are already in {@link TOOL_CATEGORY_BY_NAME} and never match.
 */
export const getMcpServerFromToolName = (toolName: string): string | undefined => {
	if (getToolCategory(toolName)) return undefined;
	const sep = toolName.indexOf("_");
	if (sep <= 0) return undefined;
	const server = toolName.slice(0, sep);
	const rest = toolName.slice(sep + 1);
	if (!rest) return undefined;
	if (!/^[a-z][a-z0-9-]*$/i.test(server)) return undefined;
	return server.toLowerCase();
};

export const isMcpActivityKind = (kind: ActivityKind): kind is McpActivityKind =>
	kind.startsWith("mcp:");

export const getMcpServerId = (kind: McpActivityKind): string => kind.slice("mcp:".length);

export const formatMcpServerLabel = (serverId: string): string =>
	serverId
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(" ");

/** Local tool name after the `{server}_` MCP prefix, if this is an MCP tool. */
export const getMcpToolLocalName = (toolName: string): string | undefined => {
	if (!getMcpServerFromToolName(toolName)) return undefined;
	return toolName.slice(toolName.indexOf("_") + 1);
};

export type ActivityGroupKey =
	| `group-${ToolCategory | "tools" | "thinking"}`
	| `group-mcp-${string}`;

export const getGroupKeyForTool = (toolName: string): ActivityGroupKey => {
	const category = getToolCategory(toolName);
	if (category) return `group-${category}`;
	const mcp = getMcpServerFromToolName(toolName);
	if (mcp) return `group-mcp-${mcp}`;
	return "group-tools";
};

/** Resolve a `group-*` key from GroupedParts back to an {@link ActivityKind}. */
export const activityKindFromGroupKey = (groupKey: string): ActivityKind | undefined => {
	if (!groupKey.startsWith("group-")) return undefined;
	const rest = groupKey.slice("group-".length);
	if (rest.startsWith("mcp-")) {
		const serverId = rest.slice("mcp-".length);
		return serverId ? `mcp:${serverId}` : undefined;
	}
	if (
		rest === "thinking" ||
		rest === "tools" ||
		rest === "editing" ||
		rest === "writing" ||
		rest === "reading" ||
		rest === "searching" ||
		rest === "web" ||
		rest === "terminal" ||
		rest === "planning" ||
		rest === "asking" ||
		rest === "suggesting" ||
		rest === "skill" ||
		rest === "subagent"
	) {
		return rest;
	}
	return undefined;
};

/**
 * Minimal structural view of a message part, so the helpers stay pure and
 * accept the store's `PartState` union without importing it.
 */
export type ActivityPart = {
	type: string;
	toolName?: string | undefined;
	toolCallId?: string | undefined;
	args?: unknown;
	result?: unknown;
	status?: { type: string } | undefined;
};

/** Grouping kind for a part; undefined for parts that pass through (hidden data parts). */
export const getActivityKind = (part: ActivityPart): ActivityKind | undefined => {
	if (part.type === "reasoning") return "thinking";
	if (part.type === "tool-call") {
		if (!part.toolName) return "tools";
		const category = getToolCategory(part.toolName);
		if (category) return category;
		const mcp = getMcpServerFromToolName(part.toolName);
		if (mcp) return `mcp:${mcp}`;
		return "tools";
	}
	return undefined;
};

export const getPartToolCallId = (part: ActivityPart): string | undefined =>
	typeof part.toolCallId === "string" ? part.toolCallId : undefined;

/** True when any asking part in `indices` matches a pending question tool call. */
export const indicesHavePendingAsk = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
	pendingCallIds: ReadonlySet<string>,
): boolean => {
	if (pendingCallIds.size === 0) return false;
	for (const index of indices) {
		const part = parts[index];
		if (!part || getActivityKind(part) !== "asking") continue;
		const callId = getPartToolCallId(part);
		if (callId && pendingCallIds.has(callId)) return true;
	}
	return false;
};

/** Index of the last asking tool part in the message, or -1. */
export const lastAskingPartIndex = (parts: readonly ActivityPart[]): number => {
	for (let i = parts.length - 1; i >= 0; i--) {
		if (getActivityKind(parts[i]!) === "asking") return i;
	}
	return -1;
};

export type ActivitySegment = {
	kind: ActivityKind;
	/** Indices into the message's parts array. */
	indices: number[];
	running: boolean;
	requiresAction: boolean;
};

/**
 * Run-length encode parts into consecutive same-kind segments. Mirrors the
 * adjacency coalescing of `MessagePrimitive.GroupedParts` (whose groupBy
 * derives from the same `getActivityKind`), so segment boundaries match the
 * rendered subgroup rows one-to-one.
 */
export const buildActivitySegments = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
): ActivitySegment[] => {
	const segments: ActivitySegment[] = [];
	for (const index of indices) {
		const part = parts[index];
		if (!part) continue;
		const kind = getActivityKind(part);
		if (!kind) continue;
		const running = part.status?.type === "running";
		const requiresAction = part.status?.type === "requires-action";
		const last = segments[segments.length - 1];
		if (last && last.kind === kind) {
			last.indices.push(index);
			last.running ||= running;
			last.requiresAction ||= requiresAction;
		} else {
			segments.push({ kind, indices: [index], running, requiresAction });
		}
	}
	return segments;
};

const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
	`${n} ${n === 1 ? singular : pluralForm}`;

export type KindStats = {
	/** Number of items in the group (tool calls or reasoning parts). */
	count: number;
	/** Unique files touched; only meaningful for file categories. */
	files: number;
	/** Basename of the touched file, when the group touched exactly one. */
	file?: string | undefined;
	/** Short question prompt for asking subgroups. */
	question?: string | undefined;
	/** Suggestion text for a suggesting subgroup. */
	suggestion?: string | undefined;
	/** Description or abbreviated command for a single terminal tool call. */
	commandSummary?: string | undefined;
	/** Skill id for a skill subgroup that loaded exactly one skill. */
	skill?: string | undefined;
	/** Short task description (or agent type) for a single subagent call. */
	task?: string | undefined;
};

type KindMeta = {
	icon: LucideIcon;
	label: string;
	liveLabel: (stats: KindStats) => string;
	doneLabel: (stats: KindStats) => string;
	/**
	 * Border, background tint, and icon color of the kind's circle. Written as
	 * full literal class names so the Tailwind scanner can see them.
	 */
	circleClassName: string;
};

const KIND_META: Record<Exclude<ActivityKind, McpActivityKind>, KindMeta> = {
	thinking: {
		icon: BrainIcon,
		label: "Thinking",
		liveLabel: () => "Thinking...",
		doneLabel: () => "Thought",
		circleClassName:
			"border-violet-600/40 bg-violet-100 text-violet-600 dark:border-violet-400/40 dark:bg-violet-950 dark:text-violet-400",
	},
	editing: {
		icon: FilePenIcon,
		label: "Editing",
		liveLabel: ({ files, count, file }) =>
			file ? `Editing ${file}` : `Editing ${plural(files || count, "file")}`,
		doneLabel: ({ files, count, file }) =>
			file ? `Edited ${file}` : `Edited ${plural(files || count, "file")}`,
		circleClassName:
			"border-amber-600/40 bg-amber-100 text-amber-600 dark:border-amber-400/40 dark:bg-amber-950 dark:text-amber-400",
	},
	writing: {
		icon: FilePlusIcon,
		label: "Writing",
		liveLabel: ({ files, count, file }) =>
			file ? `Writing ${file}` : `Writing ${plural(files || count, "file")}`,
		doneLabel: ({ files, count, file }) =>
			file ? `Wrote ${file}` : `Wrote ${plural(files || count, "file")}`,
		circleClassName:
			"border-emerald-600/40 bg-emerald-100 text-emerald-600 dark:border-emerald-400/40 dark:bg-emerald-950 dark:text-emerald-400",
	},
	reading: {
		icon: BookOpenIcon,
		label: "Reading",
		liveLabel: ({ files, count, file }) =>
			file ? `Reading ${file}` : `Reading ${plural(files || count, "file")}`,
		doneLabel: ({ files, count, file }) =>
			file ? `Read ${file}` : `Read ${plural(files || count, "file")}`,
		circleClassName:
			"border-sky-600/40 bg-sky-100 text-sky-600 dark:border-sky-400/40 dark:bg-sky-950 dark:text-sky-400",
	},
	searching: {
		icon: SearchIcon,
		label: "Searching",
		liveLabel: () => "Searching the codebase",
		doneLabel: ({ count }) => plural(count, "search", "searches"),
		circleClassName:
			"border-cyan-600/40 bg-cyan-100 text-cyan-600 dark:border-cyan-400/40 dark:bg-cyan-950 dark:text-cyan-400",
	},
	web: {
		icon: GlobeIcon,
		label: "Web",
		liveLabel: () => "Browsing the web",
		doneLabel: ({ count }) => plural(count, "web request"),
		circleClassName:
			"border-blue-600/40 bg-blue-100 text-blue-600 dark:border-blue-400/40 dark:bg-blue-950 dark:text-blue-400",
	},
	terminal: {
		icon: TerminalIcon,
		label: "Terminal",
		liveLabel: ({ count, commandSummary }) =>
			commandSummary ? `Running ${commandSummary}` : `Running ${plural(count, "command")}`,
		doneLabel: ({ count, commandSummary }) =>
			commandSummary ? `Ran ${commandSummary}` : `Ran ${plural(count, "command")}`,
		circleClassName:
			"border-zinc-600/40 bg-zinc-100 text-zinc-600 dark:border-zinc-400/40 dark:bg-zinc-950 dark:text-zinc-400",
	},
	planning: {
		icon: ListTodoIcon,
		label: "Planning",
		liveLabel: () => "Planning...",
		doneLabel: ({ count }) => plural(count, "plan update"),
		circleClassName:
			"border-rose-600/40 bg-rose-100 text-rose-600 dark:border-rose-400/40 dark:bg-rose-950 dark:text-rose-400",
	},
	asking: {
		icon: CircleHelpIcon,
		label: "Question",
		liveLabel: () => "Asking",
		doneLabel: ({ question, count }) =>
			question ? `Asked ${question}` : `Asked ${plural(count, "question")}`,
		circleClassName:
			"border-indigo-600/40 bg-indigo-100 text-indigo-600 dark:border-indigo-400/40 dark:bg-indigo-950 dark:text-indigo-400",
	},
	suggesting: {
		icon: LightbulbIcon,
		label: "Suggestion",
		liveLabel: () => "Suggesting",
		doneLabel: ({ suggestion, count }) =>
			suggestion ? `Suggested ${suggestion}` : `Suggested ${plural(count, "action")}`,
		circleClassName:
			"border-amber-600/40 bg-amber-100 text-amber-600 dark:border-amber-400/40 dark:bg-amber-950 dark:text-amber-400",
	},
	skill: {
		icon: SparklesIcon,
		label: "Skill",
		liveLabel: () => "Reading Skill",
		doneLabel: ({ skill, count }) =>
			skill || count <= 1 ? "Read Skill" : `Read ${plural(count, "Skill")}`,
		circleClassName:
			"border-fuchsia-600/40 bg-fuchsia-100 text-fuchsia-600 dark:border-fuchsia-400/40 dark:bg-fuchsia-950 dark:text-fuchsia-400",
	},
	subagent: {
		icon: BotIcon,
		label: "Subagent",
		liveLabel: ({ task }) => (task ? `Delegating ${task}` : "Delegating..."),
		doneLabel: ({ task, count }) =>
			task
				? `Delegated ${task}`
				: count <= 1
					? "Delegated"
					: `Delegated ${plural(count, "subagent")}`,
		circleClassName:
			"border-purple-600/40 bg-purple-100 text-purple-600 dark:border-purple-400/40 dark:bg-purple-950 dark:text-purple-400",
	},
	tools: {
		icon: WrenchIcon,
		label: "Tools",
		liveLabel: () => "Using tools",
		doneLabel: ({ count }) => `Used ${plural(count, "tool")}`,
		circleClassName:
			"border-orange-600/40 bg-orange-100 text-orange-600 dark:border-orange-400/40 dark:bg-orange-950 dark:text-orange-400",
	},
};

type McpKindOverride = Pick<KindMeta, "icon" | "label" | "circleClassName"> & {
	/** Local MCP tool name → label shown inside the group. */
	toolLabels?: Record<string, string>;
};

/**
 * Presentation for MCP servers that should look like first-class product
 * groups rather than a title-cased server id with the generic wrench.
 * Grouping still keys off `mcp:{server}` / `group-mcp-{server}`.
 */
const MCP_KIND_OVERRIDES: Record<string, McpKindOverride> = {
	notebooks: {
		icon: NotebookIcon,
		label: "Notebooks",
		circleClassName:
			"border-teal-600/40 bg-teal-100 text-teal-600 dark:border-teal-400/40 dark:bg-teal-950 dark:text-teal-400",
		toolLabels: {
			create_notebook: "Create notebook",
			connect_notebook: "Connect notebook",
			save_notebook: "Save notebook",
			show_notebook: "Show notebook",
			disconnect_notebook: "Disconnect notebook",
			list_active_notebooks: "List notebooks",
			list_notebooks: "List notebooks",
			create_cell: "Create cell",
			set_cell: "Edit cell",
			delete_cell: "Delete cell",
			move_cell: "Move cell",
			get_cell: "Read cell",
			get_all_cells: "List cells",
			execute_cell: "Run cell",
			run_all_cells: "Run all cells",
			get_results: "Get results",
			interrupt_kernel: "Interrupt kernel",
			restart_kernel: "Restart kernel",
			manage_dependencies: "Manage dependencies",
			replace_match: "Replace text",
			replace_regex: "Replace regex",
			create_comment: "Create comment",
			reply_comment: "Reply to comment",
			resolve_comment: "Resolve comment",
			reopen_comment: "Reopen comment",
		},
	},
};

const sentenceCaseToolName = (name: string): string => {
	const words = name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[-_\s]+/)
		.filter(Boolean);
	if (words.length === 0) return name;
	return words
		.map((word, index) => {
			const lower = word.toLowerCase();
			return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
		})
		.join(" ");
};

/** User-facing tool label: MCP server prefix stripped, then a display name. */
export const formatToolDisplayName = (toolName: string): string => {
	const server = getMcpServerFromToolName(toolName);
	const localName = getMcpToolLocalName(toolName);
	if (!server || !localName) return toolName;
	return MCP_KIND_OVERRIDES[server]?.toolLabels?.[localName] ?? sentenceCaseToolName(localName);
};

const mcpKindMeta = (kind: McpActivityKind): KindMeta => {
	const serverId = getMcpServerId(kind);
	const override = MCP_KIND_OVERRIDES[serverId];
	const label = override?.label ?? formatMcpServerLabel(serverId);
	return {
		icon: override?.icon ?? WrenchIcon,
		label,
		liveLabel: () => `${label}...`,
		doneLabel: () => label,
		circleClassName: override?.circleClassName ?? KIND_META.tools.circleClassName,
	};
};

export const getKindMeta = (kind: ActivityKind): KindMeta =>
	isMcpActivityKind(kind) ? mcpKindMeta(kind) : KIND_META[kind];

const FILE_ARG_KEYS = ["file_path", "filePath", "path", "file"] as const;

/** Files touched by a single tool-call part (multi-file for apply_patch). */
export const getPartFiles = (part: ActivityPart): string[] => {
	const args = part.args as Record<string, unknown> | undefined;
	if (!args) return [];
	if (part.toolName?.toLowerCase() === "apply_patch") {
		return getPatchInfo(str(args.patchText)).files;
	}
	for (const key of FILE_ARG_KEYS) {
		const value = str(args[key]);
		if (value) return [value];
	}
	return [];
};

const uniqueFiles = (parts: readonly ActivityPart[], indices: readonly number[]): string[] => {
	const files = new Set<string>();
	for (const index of indices) {
		const part = parts[index];
		if (!part) continue;
		for (const file of getPartFiles(part)) files.add(file);
	}
	return [...files];
};

const questionSummaryFromArgs = (args: unknown): string | undefined => {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	const fromQuestionInfo = (value: unknown): string | undefined => {
		if (!value || typeof value !== "object") return undefined;
		const info = value as Record<string, unknown>;
		const question = str(info.question);
		if (question) return truncate(question, 72);
		const header = str(info.header);
		if (header) return truncate(header, 72);
		return undefined;
	};

	if (Array.isArray(record.questions) && record.questions.length > 0) {
		const first = fromQuestionInfo(record.questions[0]);
		if (first) return first;
		if (record.questions.length > 1) return `${record.questions.length} questions`;
	}

	return (
		fromQuestionInfo(record) ?? (str(record.prompt) ? truncate(str(record.prompt), 48) : undefined)
	);
};

/** Prefer the first concrete question prompt in the segment. */
export const getPartQuestionSummary = (part: ActivityPart): string | undefined => {
	if (part.type !== "tool-call" || !part.toolName || !isAskQuestionTool(part.toolName)) {
		return undefined;
	}
	return questionSummaryFromArgs(part.args);
};

/** OpenCode/Kilo `suggest` tool takes `{ suggest, actions }`. */
export const getPartSuggestionSummary = (part: ActivityPart): string | undefined => {
	if (part.type !== "tool-call" || !part.toolName || !isSuggestTool(part.toolName)) {
		return undefined;
	}
	if (!part.args || typeof part.args !== "object") return undefined;
	const text = str((part.args as Record<string, unknown>).suggest);
	return text ? truncate(text, 48) : undefined;
};

/** OpenCode/Kilo `skill` tool takes `{ name }`. */
export const getPartSkillName = (part: ActivityPart): string | undefined => {
	if (part.type !== "tool-call" || !part.toolName || !isSkillTool(part.toolName)) {
		return undefined;
	}
	if (!part.args || typeof part.args !== "object") return undefined;
	const name = str((part.args as Record<string, unknown>).name);
	return name ? truncate(name, 48) : undefined;
};

/** OpenCode/Kilo `task` tool takes `{ description, prompt, subagent_type }`. */
export const getPartTaskDescription = (part: ActivityPart): string | undefined => {
	if (part.type !== "tool-call" || !part.toolName || !isTaskTool(part.toolName)) {
		return undefined;
	}
	if (!part.args || typeof part.args !== "object") return undefined;
	const record = part.args as Record<string, unknown>;
	const description = str(record.description).replace(/\s+/g, " ").trim();
	if (description) return truncate(description, 72);
	const agent = str(record.subagent_type).trim();
	return agent ? truncate(agent, 48) : undefined;
};

const uniqueSkillNames = (parts: readonly ActivityPart[], indices: readonly number[]): string[] => {
	const names = new Set<string>();
	for (const index of indices) {
		const part = parts[index];
		if (!part) continue;
		const name = getPartSkillName(part);
		if (name) names.add(name);
	}
	return [...names];
};

const uniqueTaskDescriptions = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
): string[] => {
	const names = new Set<string>();
	for (const index of indices) {
		const part = parts[index];
		if (!part) continue;
		const name = getPartTaskDescription(part);
		if (name) names.add(name);
	}
	return [...names];
};

export const getSegmentStats = (
	parts: readonly ActivityPart[],
	segment: ActivitySegment,
): KindStats => {
	const files = uniqueFiles(parts, segment.indices);
	let question: string | undefined;
	if (segment.kind === "asking") {
		for (const index of segment.indices) {
			const part = parts[index];
			if (!part) continue;
			question = getPartQuestionSummary(part);
			if (question) break;
		}
	}
	let suggestion: string | undefined;
	if (segment.kind === "suggesting") {
		for (const index of segment.indices) {
			const part = parts[index];
			if (!part) continue;
			suggestion = getPartSuggestionSummary(part);
			if (suggestion) break;
		}
	}
	const commandSummary =
		segment.kind === "terminal" && segment.indices.length === 1
			? getCommandSummary(parts[segment.indices[0]!]?.args as Record<string, unknown> | undefined)
			: undefined;
	const skills =
		segment.kind === "skill" ? uniqueSkillNames(parts, segment.indices) : ([] as string[]);
	const tasks =
		segment.kind === "subagent" ? uniqueTaskDescriptions(parts, segment.indices) : ([] as string[]);
	return {
		count: segment.indices.length,
		files: files.length,
		file: files.length === 1 ? basename(files[0]!) : undefined,
		question,
		suggestion,
		commandSummary: commandSummary || undefined,
		skill: skills.length === 1 ? skills[0] : undefined,
		task: tasks.length === 1 ? tasks[0] : undefined,
	};
};

/**
 * True when a solo tool row hides itself (SoloAwareExpandableRow's
 * hideSoloWithoutDetail): a quiet successful command or a task without output
 * renders nothing under the subgroup header, so the header must stay
 * label-only — a disclosure would reveal an empty body. Mirrors the row
 * components' null conditions.
 */
export const soloRowHidesItself = (kind: ActivityKind, part: ActivityPart | undefined): boolean => {
	if (!part) return false;
	if (kind === "terminal") {
		if (isCancelledToolStatus(part.status)) return false;
		const running = part.status?.type === "running";
		const parsed = running ? {} : parseBashResult(part.result);
		if (!running && (parsed.exitCode ?? 0) !== 0) return false;
		return !(parsed.stdout || parsed.stderr);
	}
	if (kind === "subagent") {
		const raw = resultText(part.result);
		if (isTaskErrorOutput(raw)) return false;
		return !(part.status?.type !== "running" && unwrapTaskOutput(raw).length > 0);
	}
	return false;
};

export type ActivityIconItem = {
	icon: LucideIcon;
	label: string;
	className?: string | undefined;
	/**
	 * Whether the circle renders in the kind's color. Neutral (muted) unless
	 * its group is currently active or expanded.
	 */
	colored?: boolean | undefined;
	/** Orbiting loading ring around the circle while its group streams. */
	loading?: boolean | undefined;
};

export type ActivitySummary = {
	segments: ActivitySegment[];
	toolCount: number;
	requiresAction: boolean;
	label: string;
	iconItems: ActivityIconItem[];
};

export const summarizeActivity = (
	parts: readonly ActivityPart[],
	indices: readonly number[],
): ActivitySummary => {
	const segments = buildActivitySegments(parts, indices);
	const toolCount = segments.reduce(
		(n, segment) => (segment.kind === "thinking" ? n : n + segment.indices.length),
		0,
	);
	const requiresAction = segments.some((segment) => segment.requiresAction);

	return {
		segments,
		toolCount,
		requiresAction,
		label: `${plural(toolCount, "tool")} used`,
		// One circle per subgroup run, in order of appearance — a kind that
		// recurs later in the turn (thinking → editing → thinking) gets a
		// circle per run.
		iconItems: segments.map((segment) => {
			const meta = getKindMeta(segment.kind);
			return {
				icon: meta.icon,
				label: meta.label,
				className: meta.circleClassName,
			};
		}),
	};
};
