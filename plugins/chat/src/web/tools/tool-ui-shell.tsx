import { CheckIcon, CircleXIcon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { useOpenCodeTool } from "./opencode-tool";
import { readShellResult } from "./shell-result";
import { SoloAwareExpandableRow } from "./tool-ui-activity-row";
import {
	getCommandSummary,
	isCancelledToolStatus,
	normalizeBashOutput,
	ToolOutputBlock,
} from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";

export const ShellTerminal: ToolCallComponent = ({ args, result, status, toolCallId }) => {
	const command = typeof args?.command === "string" ? args.command : "";
	const isRunning = status?.type === "running";
	const isCancelled = isCancelledToolStatus(status);
	const shell = readShellResult(useOpenCodeTool(toolCallId), result);

	const output = shell.output ? normalizeBashOutput(shell.output) : undefined;
	// A backgrounded command's notice tells the model to wait; the output already says it moved.
	const notice = shell.notice && !shell.background ? normalizeBashOutput(shell.notice) : undefined;
	const hasOutput = Boolean(output || notice);
	const isError = !isRunning && (shell.failed || status?.type === "incomplete") && !isCancelled;

	const summaryText = getCommandSummary(args);

	const completeIcon = isError ? (
		<CircleXIcon className="text-destructive size-3 shrink-0" />
	) : (
		<CheckIcon className="size-3 shrink-0" />
	);

	return (
		<SoloAwareExpandableRow
			kind="terminal"
			liveVerb="Running"
			doneVerb={isCancelled ? "Cancelled" : isError ? "Failed" : "Ran"}
			object={summaryText || undefined}
			status={status}
			disclosureId={toolCallId}
			hasDetail={isRunning ? Boolean(command) || hasOutput : hasOutput}
			completeIcon={completeIcon}
			hideSoloWithoutDetail={!isError && !isCancelled}
			detail={
				<ToolOutputBlock>
					{command ? <div className="text-muted-foreground mb-2">$ {command}</div> : null}
					{output ? (
						<pre className="text-foreground wrap-break-word whitespace-pre-wrap">{output}</pre>
					) : null}
					{notice ? (
						<pre
							className={cn(
								"wrap-break-word whitespace-pre-wrap",
								isError ? "text-destructive" : "text-muted-foreground",
								output && "mt-2",
							)}
						>
							{notice}
						</pre>
					) : null}
				</ToolOutputBlock>
			}
		/>
	);
};
ShellTerminal.displayName = "ShellTerminal";
