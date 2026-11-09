import type { FC } from "react";

import { useExtensions } from "@kilo-desktop/kernel/web";

import { ComposerAction } from "../../contracts";
import { ComposerActionSlotView } from "./composer-actions";

/**
 * The strip under a new chat's composer for `draft-footer` composer actions,
 * in place of the usage footer it has once it exists; absent while nothing
 * is contributed, and hidden while every contribution renders nothing (a
 * `view` that only shows a warning when there is one).
 */
export const ComposerDraftFooter: FC = () => {
	const hasActions = useExtensions(ComposerAction).some(
		(contribution) => contribution.metadata.slot === "draft-footer",
	);
	if (!hasActions) return null;
	return (
		<div
			data-slot="aui_composer-draft-footer"
			data-qa-id="kilo-composer-draft-footer"
			className="bg-pane relative z-10 flex w-full min-w-0 items-center gap-2 pl-1 has-[>[data-slot=composer-draft-actions]:empty]:hidden"
		>
			<div data-slot="composer-draft-actions" className="flex min-w-0 flex-1 items-center gap-1">
				<ComposerActionSlotView slot="draft-footer" />
			</div>
		</div>
	);
};
