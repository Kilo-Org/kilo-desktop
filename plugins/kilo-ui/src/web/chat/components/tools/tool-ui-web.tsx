import { memo } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { SoloAwareExpandableRow, hostnameFromUrl, resultText } from "./tool-ui-activity-row.js";
import { truncate } from "./tool-ui-shared.js";

const OutputDetail = ({ text }: { text: string }) => (
	<pre className="bg-muted/50 max-h-96 overflow-y-auto rounded-md border p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap">
		{text}
	</pre>
);

export const WebSearchActivity: ToolCallMessagePartComponent = memo(({ args, result, status }) => {
	const query =
		typeof (args as Record<string, unknown> | undefined)?.query === "string"
			? ((args as Record<string, unknown>).query as string)
			: undefined;
	const output = resultText(result);
	const hasDetail = output.length > 0 && status?.type !== "running";

	return (
		<SoloAwareExpandableRow
			kind="web"
			liveVerb="Searching"
			doneVerb="Searched"
			object={query ? truncate(query) : undefined}
			status={status}
			hasDetail={hasDetail}
			detail={<OutputDetail text={output} />}
		/>
	);
});
WebSearchActivity.displayName = "WebSearchActivity";

export const WebFetchActivity: ToolCallMessagePartComponent = memo(({ args, result, status }) => {
	const url =
		typeof (args as Record<string, unknown> | undefined)?.url === "string"
			? ((args as Record<string, unknown>).url as string)
			: undefined;
	const host = url ? hostnameFromUrl(url) : undefined;
	const output = resultText(result);
	const hasDetail = output.length > 0 && status?.type !== "running";

	return (
		<SoloAwareExpandableRow
			kind="web"
			liveVerb="Fetching"
			doneVerb="Fetched"
			object={host ? truncate(host) : undefined}
			status={status}
			hasDetail={hasDetail}
			detail={<OutputDetail text={output} />}
		/>
	);
});
WebFetchActivity.displayName = "WebFetchActivity";
