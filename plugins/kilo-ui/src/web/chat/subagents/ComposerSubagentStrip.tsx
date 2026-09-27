import { memo } from "react";
import { ArrowUpIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { COMPOSER_SHELF_HEADER_CLASS, ComposerShelf } from "../components/composer-shelf.js";
import { useDelegationRevealStore } from "./delegation-reveal-store.js";
import { useSubagentActivity } from "./SubagentActivityContext.js";

/**
 * A one-line shelf above the composer while subagents run. The transcript's
 * delegation rows are where subagents are opened and stopped; this only
 * points at them when they are scrolled away, folded, or delegated in the
 * background, and jumps to the first running one.
 */
export const ComposerSubagentStrip = memo(() => {
	const { activeActivities } = useSubagentActivity();
	const reveal = useDelegationRevealStore((state) => state.reveal);
	const first = activeActivities[0];
	if (!first) return null;

	const label = `${activeActivities.length} Running`;
	return (
		<ComposerShelf data-qa-id="kilo-composer-subagents">
			<button
				type="button"
				className={COMPOSER_SHELF_HEADER_CLASS}
				onClick={() => reveal(first.toolCallId)}
				aria-label={`Show subagents in chat: ${label}`}
				data-qa-id="kilo-composer-subagents-jump"
			>
				<span className="flex min-w-0 items-center gap-2">
					<span className="shrink-0">Subagents</span>
					<span className="text-foreground/70 flex items-center gap-1.5 font-normal">
						<span aria-hidden className="text-foreground/25">
							·
						</span>
						<Spinner className="text-primary-ink size-3 shrink-0 motion-reduce:animate-none" />
						<span className="tabular-nums">{label}</span>
					</span>
				</span>
				<ArrowUpIcon aria-hidden className="size-3.5 shrink-0" />
			</button>
		</ComposerShelf>
	);
});
ComposerSubagentStrip.displayName = "ComposerSubagentStrip";
