import { useAui } from "@assistant-ui/react";
import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import {
	selectOpenCodeExtras,
	useOlderHistoryStatus,
} from "../runtime/use-optional-opencode-runtime-extras";

/**
 * Above the transcript while its older messages are still to come (a session
 * opens on its newest page): a reader who reaches the top before they land
 * sees them coming, or a retry if they failed.
 */
export const OlderHistoryStatus: FC = () => {
	const status = useOlderHistoryStatus();
	const aui = useAui();
	if (status === "complete") return null;

	const retry = () => void selectOpenCodeExtras(aui.thread.getState().extras)?.refresh();

	return (
		<div
			data-slot="older-history-status"
			role="status"
			className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-sm"
		>
			{status === "loading" ? (
				<>
					<Spinner className="size-3.5" />
					Loading earlier messages…
				</>
			) : (
				<>
					Couldn't load earlier messages.
					<Button variant="link" size="sm" className="h-auto p-0" onClick={retry}>
						Retry
					</Button>
				</>
			)}
		</div>
	);
};
