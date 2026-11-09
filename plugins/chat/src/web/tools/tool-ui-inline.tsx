import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { formatToolDisplayName } from "./tool-categories";
import {
	ToolStatusIcon,
	isCancelledToolStatus,
	truncate,
	type ToolCallStatusLike,
} from "./tool-ui-shared";

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

const SUMMARY_KEYS = ["file_path", "path", "pattern", "command", "query", "glob", "url"] as const;

const ToolCallFallbackImpl: ToolCallMessagePartComponent = ({ toolName, args, status }) => {
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
