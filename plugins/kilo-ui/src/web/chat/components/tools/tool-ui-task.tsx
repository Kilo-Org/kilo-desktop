import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { PlanMarkdown } from "../../plan/PlanMarkdown.js";
import { SoloAwareExpandableRow, resultText } from "./tool-ui-activity-row.js";
import { str, truncate } from "./tool-ui-shared.js";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const TASK_OUTPUT_TAG = /<(task_result|task_error)>\s*([\s\S]*?)\s*<\/\1>/i;

export const getTaskDescription = (args: unknown): string | undefined => {
	const record = asRecord(args);
	const description = str(record?.description).replace(/\s+/g, " ").trim();
	if (description) return truncate(description, 72);
	const agent = str(record?.subagent_type).trim();
	return agent ? truncate(agent, 48) : undefined;
};

export const getTaskAgent = (args: unknown): string | undefined => {
	const agent = str(asRecord(args)?.subagent_type).trim();
	return agent || undefined;
};

export const getTaskPrompt = (args: unknown): string | undefined => {
	const prompt = str(asRecord(args)?.prompt).trim();
	return prompt || undefined;
};

export const unwrapTaskOutput = (raw: string): string => {
	const match = raw.match(TASK_OUTPUT_TAG);
	if (match?.[2]) return match[2].trim();
	return raw.trim();
};

export const isTaskErrorOutput = (raw: string): boolean => /<task_error>/i.test(raw);

const TaskDetail = ({
	agent,
	output,
	isError,
}: {
	agent?: string | undefined;
	output: string;
	isError: boolean;
}) => (
	<div className="flex flex-col gap-2 py-0.5" data-slot="kilo-task-detail">
		{agent ? <div className="text-muted-foreground text-xs font-medium">@{agent}</div> : null}
		{output ? (
			<div className={cn("max-h-96 overflow-y-auto", isError && "text-destructive-foreground")}>
				<PlanMarkdown text={output} />
			</div>
		) : null}
	</div>
);

export const TaskActivity: ToolCallMessagePartComponent = memo(({ args, result, status }) => {
	const description = getTaskDescription(args);
	const agent = getTaskAgent(args);
	const raw = resultText(result);
	const output = unwrapTaskOutput(raw);
	const isError = isTaskErrorOutput(raw);
	const hasDetail = output.length > 0 && status?.type !== "running";

	return (
		<SoloAwareExpandableRow
			kind="subagent"
			liveVerb="Delegating"
			doneVerb={isError ? "Failed" : "Delegated"}
			object={description}
			status={status}
			hasDetail={hasDetail}
			hideSoloWithoutDetail={!isError}
			detail={<TaskDetail agent={agent} output={output} isError={isError} />}
		/>
	);
});
TaskActivity.displayName = "TaskActivity";
