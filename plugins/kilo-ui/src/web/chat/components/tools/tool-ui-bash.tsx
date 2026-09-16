import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DollarSignIcon, XCircleIcon } from "lucide-react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { SoloAwareExpandableRow } from "./tool-ui-activity-row.js";
import { getCommandSummary, isCancelledToolStatus, parseBashResult } from "./tool-ui-shared.js";

export const BashTerminal: ToolCallMessagePartComponent = memo(({ args, result, status }) => {
	const command = typeof args?.command === "string" ? args.command : "";
	const isRunning = status?.type === "running";
	const isCancelled = isCancelledToolStatus(status);

	const parsed = isRunning ? {} : parseBashResult(result);
	const stdout = parsed.stdout;
	const stderr = parsed.stderr;
	const exitCode = parsed.exitCode ?? 0;
	const hasOutput = Boolean(stdout || stderr);
	const isError = !isRunning && exitCode !== 0;

	const summaryText = getCommandSummary(args);

	const completeIcon = isError ? (
		<XCircleIcon className="text-destructive-foreground size-3 shrink-0" />
	) : (
		<DollarSignIcon className="size-3.5 shrink-0" />
	);

	return (
		<SoloAwareExpandableRow
			kind="terminal"
			liveVerb="Running"
			doneVerb={isCancelled ? "Cancelled" : isError ? "Failed" : "Ran"}
			object={summaryText || undefined}
			status={status}
			hasDetail={hasOutput}
			completeIcon={completeIcon}
			hideSoloWithoutDetail={!isError && !isCancelled}
			detail={
				<div className="bg-muted/50 max-h-96 overflow-y-auto rounded-md border p-3 font-mono text-xs">
					{command ? <div className="text-muted-foreground mb-2">$ {command}</div> : null}
					{stdout ? (
						<pre className="text-foreground wrap-break-word whitespace-pre-wrap">{stdout}</pre>
					) : null}
					{stderr ? (
						<pre
							className={cn(
								"text-destructive-foreground wrap-break-word whitespace-pre-wrap",
								stdout && "mt-2",
							)}
						>
							{stderr}
						</pre>
					) : null}
				</div>
			}
		/>
	);
});
BashTerminal.displayName = "BashTerminal";
