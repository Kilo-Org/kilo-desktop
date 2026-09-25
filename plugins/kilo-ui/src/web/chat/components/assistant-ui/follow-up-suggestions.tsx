"use client";

import { AuiIf, useAuiState, ThreadPrimitive } from "@assistant-ui/react";
import type { FC } from "react";
import { useSubagentActivity } from "../../subagents/SubagentActivityContext.js";

const FollowupSuggestionsRow: FC = () => {
	const suggestions = useAuiState((s) => s.thread.suggestions);

	return (
		<div
			// overflow-x clips both axes; py-1/-my-1 gives focus rings vertical room without changing outer height.
			className="aui-thread-followup-suggestions no-scrollbar scroll-fade-x -my-1 w-full overflow-x-auto py-1"
		>
			<div className="mx-auto flex min-h-8 w-max items-center gap-2 px-0.5">
				{suggestions.map((suggestion, idx) => (
					<ThreadPrimitive.Suggestion
						key={idx}
						className="aui-thread-followup-suggestion bg-background hover:bg-muted rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors ease-in"
						prompt={suggestion.prompt}
						method="replace"
						autoSend
					>
						{suggestion.prompt}
					</ThreadPrimitive.Suggestion>
				))}
			</div>
		</div>
	);
};

export const ThreadFollowupSuggestions: FC = () => {
	const { hasActiveSubagents } = useSubagentActivity();
	return (
		<AuiIf
			condition={(s) =>
				!hasActiveSubagents &&
				!s.thread.isEmpty &&
				!s.thread.isRunning &&
				s.thread.suggestions.length > 0
			}
		>
			<FollowupSuggestionsRow />
		</AuiIf>
	);
};
