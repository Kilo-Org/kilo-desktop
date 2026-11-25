import type { SessionMessageAssistantTool } from "@kilo-desktop/react-opencode";

import { openCodeToolMetadata } from "./opencode-tool";

/**
 * What a `shell` call shows: its output, and the notice Kilo appends for the
 * model (exit code, timeout, kill reason, interruption). Kilo v2 settles a
 * call with content `[output?, notice?]` and metadata `{status, exit?,
 * signal?, timeout?, killed?, truncated}`; a call the user interrupted fails
 * with `output\n\nnotice` and metadata `{interrupted, notice}`; a running
 * call streams `{output}` as progress metadata.
 */
export type ShellResult = {
	output: string;
	notice?: string | undefined;
	exitCode?: number | undefined;
	/** Ended badly: a non-zero exit, a signal, a timeout or a kill. */
	failed: boolean;
	/** Moved to the background; its notice is the model's instruction to wait. */
	background: boolean;
};

const textsOf = (tool: SessionMessageAssistantTool): string[] => {
	const content = (tool.state as { content?: readonly { type: string; text?: string }[] }).content;
	return (content ?? []).flatMap((item) =>
		item.type === "text" && typeof item.text === "string" ? [item.text] : [],
	);
};

const settledResult = (
	tool: SessionMessageAssistantTool,
	metadata: Record<string, unknown>,
): ShellResult => {
	const exitCode = typeof metadata.exit === "number" ? metadata.exit : undefined;
	const background = metadata.status === "running";
	const failed =
		(exitCode !== undefined && exitCode !== 0) ||
		typeof metadata.signal === "string" ||
		metadata.timeout === true ||
		metadata.killed === true;
	const texts = textsOf(tool);
	const hasNotice = background || failed;
	return {
		output: (hasNotice ? texts.slice(0, -1) : texts).join("\n"),
		notice: hasNotice ? texts.at(-1) : undefined,
		exitCode,
		failed,
		background,
	};
};

const interruptedResult = (message: string, metadata: Record<string, unknown>): ShellResult => {
	const notice = typeof metadata.notice === "string" ? metadata.notice : undefined;
	const output =
		notice && message.endsWith(notice) ? message.slice(0, -notice.length).trimEnd() : message;
	return { output, notice, failed: false, background: false };
};

/** A shell call's result from its v2 tool call, or from the part's result text without one. */
export const readShellResult = (
	tool: SessionMessageAssistantTool | undefined,
	result: unknown,
): ShellResult => {
	const metadata = openCodeToolMetadata(tool) ?? {};
	if (tool?.state.status === "completed") return settledResult(tool, metadata);
	if (tool?.state.status === "error") {
		const message = tool.state.error.message;
		return metadata.interrupted === true
			? interruptedResult(message, metadata)
			: { output: "", notice: message, failed: true, background: false };
	}
	if (tool?.state.status === "running") {
		const output = typeof metadata.output === "string" ? metadata.output : "";
		return { output, failed: false, background: false };
	}
	return {
		output: typeof result === "string" ? result : "",
		failed: false,
		background: false,
	};
};
