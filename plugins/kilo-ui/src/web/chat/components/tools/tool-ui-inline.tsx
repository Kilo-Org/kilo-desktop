import { memo, useMemo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { formatToolDisplayName } from "./tool-categories.js";
import {
	ToolStatusIcon,
	isCancelledToolStatus,
	truncate,
	type ToolCallStatusLike,
} from "./tool-ui-shared.js";

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
		<div className="text-muted-foreground flex items-center gap-2 py-0.5 text-sm">
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
	const summary = useMemo(() => {
		if (!args || typeof args !== "object") return "";
		for (const key of SUMMARY_KEYS) {
			const v = (args as Record<string, unknown>)[key];
			if (typeof v === "string" && v) return truncate(v);
		}
		return "";
	}, [args]);

	return (
		<ToolCallShell toolName={toolName} status={status}>
			{summary ? <span className="opacity-60">{summary}</span> : null}
		</ToolCallShell>
	);
};

export const ToolCallFallback = memo(ToolCallFallbackImpl);
ToolCallFallback.displayName = "ToolCallFallback";
