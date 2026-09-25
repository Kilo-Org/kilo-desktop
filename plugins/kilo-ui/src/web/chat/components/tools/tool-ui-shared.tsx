import type { ComponentProps, FC, ReactNode } from "react";
import { CheckIcon, CircleAlertIcon, CircleXIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { cn } from "@kilo-desktop/ui/lib/utils";

export type ToolCallStatusLike =
	| {
			type: string;
			reason?: string;
	  }
	| undefined;

export const truncate = (value: string, max = 80): string =>
	value.length > max ? `${value.slice(0, max - 3)}...` : value;

export const str = (value: unknown): string => (typeof value === "string" ? value : "");

export const getCommandSummary = (args: Record<string, unknown> | undefined): string => {
	const description = str(args?.description).replace(/\s+/g, " ").trim();
	if (description) return truncate(description);

	const command = str(args?.command).replace(/\s+/g, " ").trim();
	return truncate(command);
};

export const basename = (filepath: string): string => {
	const parts = filepath.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? filepath;
};

const unique = <T,>(items: readonly T[]) => [...new Set(items)];

export const getPatchInfo = (patchText: string) => {
	if (!patchText) return { files: [] as string[], added: 0, removed: 0 };

	const files = unique(
		[...patchText.matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm)]
			.map((match) => basename(match[1]!.trim()))
			.filter(Boolean),
	);

	let added = 0;
	let removed = 0;
	for (const line of patchText.split("\n")) {
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}

	return { files, added, removed };
};

export const isCancelledToolStatus = (status?: ToolCallStatusLike) =>
	status?.type === "incomplete" && status.reason === "cancelled";

/** Trailing "+N -M" line-change badges for file-mutation tool rows and group
    triggers. Visual-only metadata: the expanded rows carry the same numbers, so
    the badge stays out of accessible names. */
export const DiffCounts: FC<{ added: number; removed: number }> = ({ added, removed }) => {
	if (added <= 0 && removed <= 0) return null;
	return (
		<span aria-hidden className="ml-0.5 flex items-center gap-1 font-mono text-xs">
			{added > 0 ? <span className="text-success">+{added}</span> : null}
			{removed > 0 ? <span className="text-destructive">-{removed}</span> : null}
		</span>
	);
};

/** Visible text of a tool result payload (string, or object with output/stdout). */
export const resultText = (result: unknown): string => {
	if (typeof result === "string") return result;
	if (result && typeof result === "object") {
		const record = result as Record<string, unknown>;
		if (typeof record.output === "string") return record.output;
		if (typeof record.stdout === "string") return record.stdout;
	}
	return "";
};

export type BashResultPayload = {
	stdout?: string | undefined;
	stderr?: string | undefined;
	exitCode?: number | undefined;
};

const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE = new RegExp(
	`[${ESC}${CSI}][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?${BEL})|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))`,
	"g",
);

export const normalizeBashOutput = (value: string): string =>
	value.replace(ANSI_ESCAPE, "").replace(/\r\n?/g, "\n");

/** OpenCode bash metadata.output for a running (or completed) tool call. */
export const getToolBashMetadataOutput = (
	parts: unknown,
	toolCallId: string,
): string | undefined => {
	if (!Array.isArray(parts)) return undefined;
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const record = part as Record<string, unknown>;
		if (record.type !== "tool") continue;
		const callId = record.callID ?? record.id;
		if (callId !== toolCallId) continue;
		const state = record.state;
		if (!state || typeof state !== "object") continue;
		const metadata = (state as Record<string, unknown>).metadata;
		if (!metadata || typeof metadata !== "object") continue;
		const output = (metadata as Record<string, unknown>).output;
		return typeof output === "string" && output.length > 0 ? output : undefined;
	}
	return undefined;
};

/** Bash tool result: a JSON string or an object carrying stdout/stderr/exitCode. */
export const parseBashResult = (result: unknown): BashResultPayload => {
	if (!result) return {};
	let record: Record<string, unknown> | undefined;
	if (typeof result === "string") {
		try {
			const parsed: unknown = JSON.parse(result);
			if (typeof parsed === "object" && parsed !== null) {
				record = parsed as Record<string, unknown>;
			}
		} catch {
			// plain text output
		}
		if (!record) return { stdout: result };
	} else if (typeof result === "object") {
		record = result as Record<string, unknown>;
	}
	if (!record) return {};
	const stdout =
		typeof record.stdout === "string"
			? record.stdout
			: typeof record.output === "string"
				? record.output
				: undefined;
	const exitCode =
		typeof record.exitCode === "number"
			? record.exitCode
			: typeof record.exit === "number"
				? record.exit
				: undefined;
	return {
		stdout,
		stderr: typeof record.stderr === "string" ? record.stderr : undefined,
		exitCode,
	};
};

const TASK_OUTPUT_TAG = /<(task_result|task_error)>\s*([\s\S]*?)\s*<\/\1>/i;

export const unwrapTaskOutput = (raw: string): string => {
	const match = raw.match(TASK_OUTPUT_TAG);
	if (match?.[2]) return match[2].trim();
	return raw.trim();
};

export const isTaskErrorOutput = (raw: string): boolean => /<task_error>/i.test(raw);

export const ToolStatusIcon = ({
	status,
	completeIcon,
}: {
	status?: ToolCallStatusLike;
	completeIcon?: ReactNode;
}) => {
	const statusType = status?.type ?? "complete";
	const isCancelled = isCancelledToolStatus(status);

	if (statusType === "running") {
		return <Spinner className="size-3 shrink-0" />;
	}

	if (statusType === "requires-action") {
		return <CircleAlertIcon className="text-warning size-3 shrink-0" />;
	}

	if (statusType === "incomplete") {
		return <CircleXIcon className={cn("size-3 shrink-0", !isCancelled && "text-destructive")} />;
	}

	return completeIcon ?? <CheckIcon className="size-3 shrink-0" />;
};

/** Monospace, scroll-capped panel for tool output in an expanded activity row. */
export const ToolOutputBlock = ({ className, ...props }: ComponentProps<"div">) => (
	<div
		className={cn(
			"bg-muted/50 max-h-96 overflow-y-auto rounded-md border p-3 font-mono text-xs",
			className,
		)}
		{...props}
	/>
);

/** Plain wrapped text output (search results, fetched pages, grep matches). */
export const ToolOutputText = ({ text }: { text: string }) => (
	<ToolOutputBlock>
		<pre className="wrap-break-word whitespace-pre-wrap">{text}</pre>
	</ToolOutputBlock>
);
