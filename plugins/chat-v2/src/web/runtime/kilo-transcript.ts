import type {
	KiloToolCall,
	SessionMessageAssistant,
	SessionMessageInfo,
	ToolContent,
} from "@kilo-desktop/react-opencode-v2";

/*
 * The Kilo v2 messages behind the transcript, as the chat reads them raw.
 * react-opencode projects a run of steps as one assistant-ui message and
 * carries the Kilo v2 messages it stands for as
 * `metadata.custom.opencode.messages`; renderers that need more than a tool
 * call's args and result (its metadata, file diffs, attached files, a step's
 * snapshot) look them up here, by tool call id.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const NO_MESSAGES: readonly SessionMessageInfo[] = [];

/** The Kilo v2 messages a projected message's `metadata.custom` carries (by reference, for selectors). */
export const kiloMessagesOf = (custom: unknown): readonly SessionMessageInfo[] => {
	const opencode = isRecord(custom) ? custom.opencode : undefined;
	const messages = isRecord(opencode) ? opencode.messages : undefined;
	return Array.isArray(messages) ? (messages as SessionMessageInfo[]) : NO_MESSAGES;
};

/** The assistant steps among `messages`. */
export const kiloSteps = (messages: readonly SessionMessageInfo[]): SessionMessageAssistant[] =>
	messages.filter((message): message is SessionMessageAssistant => message.type === "assistant");

/** Every tool call in `messages`' steps, in order. */
export const kiloToolCalls = (messages: readonly SessionMessageInfo[]): KiloToolCall[] =>
	kiloSteps(messages).flatMap((step) =>
		step.content.filter((item): item is KiloToolCall => item.type === "tool"),
	);

/** Every tool call in a thread state's transcript, in order. */
export const kiloThreadToolCalls = (state: {
	readonly messageOrder: readonly string[];
	readonly messagesById: Readonly<Record<string, SessionMessageInfo>>;
}): KiloToolCall[] =>
	kiloToolCalls(state.messageOrder.flatMap((id) => state.messagesById[id] ?? []));

/** The tool call with `toolCallId` in `messages`' steps. */
export const findKiloToolCall = (
	messages: readonly SessionMessageInfo[],
	toolCallId: string,
): KiloToolCall | undefined => kiloToolCalls(messages).find((tool) => tool.id === toolCallId);

/** A tool call's metadata (what it reports while running, and once done). */
export const kiloToolMetadata = (
	tool: KiloToolCall | undefined,
): Record<string, unknown> | undefined =>
	tool && tool.state.status !== "streaming" ? tool.state.metadata : undefined;

/** A finished tool call's content: its text and attached files. */
export const kiloToolContent = (tool: KiloToolCall | undefined): readonly ToolContent[] =>
	tool && (tool.state.status === "completed" || tool.state.status === "error")
		? (tool.state.content ?? [])
		: [];

/** A file a tool call changed, as Kilo's file tools report it (`metadata.files`). */
export type KiloFileChange = {
	readonly file: string;
	readonly patch: string;
	readonly additions?: number;
	readonly deletions?: number;
};

/** The files a file tool (`edit`, `write`, `patch`) reports it changed, each with its unified patch. */
export const kiloToolFileChanges = (tool: KiloToolCall | undefined): KiloFileChange[] => {
	const files = kiloToolMetadata(tool)?.files;
	if (!Array.isArray(files)) return [];
	return files.flatMap((entry) => {
		if (!isRecord(entry) || typeof entry.patch !== "string" || entry.patch.length === 0) return [];
		if (typeof entry.file !== "string") return [];
		return [
			{
				file: entry.file,
				patch: entry.patch,
				...(typeof entry.additions === "number" ? { additions: entry.additions } : {}),
				...(typeof entry.deletions === "number" ? { deletions: entry.deletions } : {}),
			},
		];
	});
};

/** A file tool call's unified diff: its files' patches, joined. */
export const kiloToolUnifiedDiff = (tool: KiloToolCall | undefined): string | undefined => {
	const patches = kiloToolFileChanges(tool).map((change) => change.patch);
	return patches.length > 0 ? patches.join("\n") : undefined;
};

/**
 * What a shell call reports beyond its text output: its output so far while it
 * runs (`metadata.output`) and its exit code (`metadata.exit`); for a composer
 * shell run (a `shell` message), its output and exit.
 */
export const kiloShellReport = (
	messages: readonly SessionMessageInfo[],
	toolCallId: string,
): { output?: string; exit?: number } => {
	const run = messages.find(
		(message) => message.type === "shell" && message.shellID === toolCallId,
	);
	if (run?.type === "shell") {
		return {
			...(run.output?.output ? { output: run.output.output } : {}),
			...(typeof run.exit === "number" ? { exit: run.exit } : {}),
		};
	}
	const metadata = kiloToolMetadata(findKiloToolCall(messages, toolCallId));
	return {
		...(typeof metadata?.output === "string" && metadata.output ? { output: metadata.output } : {}),
		...(typeof metadata?.exit === "number" ? { exit: metadata.exit } : {}),
	};
};
