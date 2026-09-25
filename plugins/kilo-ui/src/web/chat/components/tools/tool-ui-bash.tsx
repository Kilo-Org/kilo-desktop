import { memo } from "react";
import { useAuiState, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CheckIcon, CircleXIcon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { SoloAwareExpandableRow } from "./tool-ui-activity-row.js";
import {
	getCommandSummary,
	getToolBashMetadataOutput,
	isCancelledToolStatus,
	normalizeBashOutput,
	parseBashResult,
	ToolOutputBlock,
} from "./tool-ui-shared.js";

export const BashTerminal: ToolCallMessagePartComponent = memo(
	({ args, result, status, toolCallId }) => {
		const command = typeof args?.command === "string" ? args.command : "";
		const isRunning = status?.type === "running";
		const isCancelled = isCancelledToolStatus(status);
		const liveOutput = useAuiState((s) => {
			const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
			return getToolBashMetadataOutput(custom?.opencode?.parts, toolCallId);
		});

		const parsed = parseBashResult(result);
		const stdoutRaw = parsed.stdout ?? liveOutput;
		const stdout = stdoutRaw ? normalizeBashOutput(stdoutRaw) : undefined;
		const stderr = parsed.stderr ? normalizeBashOutput(parsed.stderr) : undefined;
		const exitCode = parsed.exitCode ?? 0;
		const hasOutput = Boolean(stdout || stderr);
		const isError = !isRunning && exitCode !== 0;

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
						{stdout ? (
							<pre className="text-foreground wrap-break-word whitespace-pre-wrap">{stdout}</pre>
						) : null}
						{stderr ? (
							<pre
								className={cn(
									"text-destructive wrap-break-word whitespace-pre-wrap",
									stdout && "mt-2",
								)}
							>
								{stderr}
							</pre>
						) : null}
					</ToolOutputBlock>
				}
			/>
		);
	},
);
BashTerminal.displayName = "BashTerminal";
