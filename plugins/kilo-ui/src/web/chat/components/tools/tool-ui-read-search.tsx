import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { SoloAwareExpandableRow, SoloAwareLabelRow } from "./tool-ui-activity-row.js";
import { getToolFilePath } from "./tool-ui-file-mutation.js";
import { basename, resultText, truncate } from "./tool-ui-shared.js";

export const ReadActivity: ToolCallMessagePartComponent = memo(({ args, status }) => {
	const path = getToolFilePath(args as Record<string, unknown> | undefined);
	const fileName = path ? basename(path) : undefined;

	return (
		<SoloAwareLabelRow
			kind="reading"
			liveVerb="Reading"
			doneVerb="Read"
			object={fileName}
			status={status}
		/>
	);
});
ReadActivity.displayName = "ReadActivity";

const OutputDetail = ({ text }: { text: string }) => (
	<pre className="bg-muted/50 max-h-96 overflow-y-auto rounded-md border p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap">
		{text}
	</pre>
);

export const GrepActivity: ToolCallMessagePartComponent = memo(({ args, result, status }) => {
	const record = args as Record<string, unknown> | undefined;
	const pattern =
		typeof record?.pattern === "string"
			? record.pattern
			: typeof record?.query === "string"
				? record.query
				: undefined;
	const output = resultText(result);
	const hasDetail = output.length > 0 && status?.type !== "running";

	return (
		<SoloAwareExpandableRow
			kind="searching"
			liveVerb="Searching"
			doneVerb="Searched"
			object={pattern ? truncate(pattern) : undefined}
			status={status}
			hasDetail={hasDetail}
			detail={<OutputDetail text={output} />}
		/>
	);
});
GrepActivity.displayName = "GrepActivity";

export const GlobActivity: ToolCallMessagePartComponent = memo(({ args, result, status }) => {
	const record = args as Record<string, unknown> | undefined;
	const pattern =
		typeof record?.pattern === "string"
			? record.pattern
			: typeof record?.glob === "string"
				? record.glob
				: undefined;
	const output = resultText(result);
	const hasDetail = output.length > 0 && status?.type !== "running";

	return (
		<SoloAwareExpandableRow
			kind="searching"
			liveVerb="Finding"
			doneVerb="Found"
			object={pattern ? truncate(pattern) : undefined}
			status={status}
			hasDetail={hasDetail}
			detail={<OutputDetail text={output} />}
		/>
	);
});
GlobActivity.displayName = "GlobActivity";
