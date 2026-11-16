import { NotebookTabsIcon } from "lucide-react";

import type { ToolRendererProps } from "@kilo-desktop/plugin-chat/contracts";

import { receiptText } from "./receipt";

/**
 * A workbook tool call as one quiet line in the transcript ("→ Filed to
 * Decisions: …"), so the person sees what was extracted without the chat
 * repeating it. While the call runs it shows as pending.
 */
export function FilingReceipt({ toolName, args, status, isError }: ToolRendererProps) {
	const failed = isError === true || status.type === "incomplete";
	const running = status.type === "running";
	return (
		<div
			data-qa-id="workbooks-receipt"
			data-state={failed ? "failed" : running ? "running" : "done"}
			className="text-muted-foreground data-[state=failed]:text-destructive flex items-center gap-1.5 py-0.5 text-xs data-[state=running]:opacity-60"
		>
			<NotebookTabsIcon className="size-3 shrink-0" aria-hidden />
			<span className="truncate">
				{receiptText(toolName, (args ?? {}) as Record<string, unknown>, failed)}
			</span>
		</div>
	);
}
