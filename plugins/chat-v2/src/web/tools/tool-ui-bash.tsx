import { useAuiState } from "@assistant-ui/react";
import { CheckIcon, CircleXIcon } from "lucide-react";

import { SoloAwareExpandableRow } from "./tool-ui-activity-row";
import {
	getCommandSummary,
	isCancelledToolStatus,
	normalizeBashOutput,
	resultText,
	ToolOutputBlock,
} from "./tool-ui-shared";
import type { ToolCallComponent } from "./tool-call";
import { kiloMessagesOf, kiloShellReport } from "../runtime/kilo-transcript";

export const BashTerminal: ToolCallComponent = ({ args, result, status, toolCallId }) => {
	const command = typeof args?.command === "string" ? args.command : "";
	const isRunning = status?.type === "running";
	const isCancelled = isCancelledToolStatus(status);
	const liveOutput = useAuiState(
		(s) => kiloShellReport(kiloMessagesOf(s.message.metadata?.custom), toolCallId).output,
	);
	const reportedExit = useAuiState(
		(s) => kiloShellReport(kiloMessagesOf(s.message.metadata?.custom), toolCallId).exit,
	);

	const outputRaw = resultText(result) || liveOutput;
	const output = outputRaw ? normalizeBashOutput(outputRaw) : undefined;
	const exitCode = reportedExit ?? 0;
	const hasOutput = Boolean(output);
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
					{output ? (
						<pre className="text-foreground wrap-break-word whitespace-pre-wrap">{output}</pre>
					) : null}
				</ToolOutputBlock>
			}
		/>
	);
};
BashTerminal.displayName = "BashTerminal";
