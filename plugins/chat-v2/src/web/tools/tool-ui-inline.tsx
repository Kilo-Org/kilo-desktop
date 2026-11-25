import { memo } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { formatToolDisplayName } from "./tool-categories";
import {
	ToolStatusIcon,
	isCancelledToolStatus,
	truncate,
	type ToolCallStatusLike,
} from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";

const ToolCallShell = ({
	toolName,
	status,
	children,
}: {
	toolName: string;
	status?: ToolCallStatusLike;
	children?: React.ReactNode;
}) => {
	const isCancelled = isCancelledToolStatus(status);

	return (
		<div
			className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm"
			data-qa-id="chat-tool-call"
		>
			<ToolStatusIcon status={status} />
			<span
				className={cn(
					"flex items-center gap-1.5 truncate",
					isCancelled && "line-through opacity-50",
				)}
			>
				<span className="font-medium">{formatToolDisplayName(toolName)}</span>
				{children}
			</span>
		</div>
	);
};

/**
 * Arguments the fallback row summarises a call by. It renders tools without a
 * renderer of their own (MCP servers', other plugins'), which name their
 * arguments as they like, so it tries the common names (`file_path` included).
 */
const SUMMARY_KEYS = ["path", "file_path", "pattern", "command", "query", "glob", "url"] as const;

const ToolCallFallbackImpl: ToolCallComponent = ({ toolName, args, status }) => {
	let summary = "";
	if (args && typeof args === "object") {
		for (const key of SUMMARY_KEYS) {
			const value = (args as Record<string, unknown>)[key];
			if (typeof value === "string" && value) {
				summary = truncate(value);
				break;
			}
		}
	}

	return (
		<ToolCallShell toolName={toolName} status={status}>
			{summary ? <span className="opacity-60">{summary}</span> : null}
		</ToolCallShell>
	);
};

export const ToolCallFallback = memo(ToolCallFallbackImpl);
ToolCallFallback.displayName = "ToolCallFallback";
