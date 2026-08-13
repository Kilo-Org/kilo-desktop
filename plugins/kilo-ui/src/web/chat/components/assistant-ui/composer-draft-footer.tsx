"use client";

import type { FC } from "react";

import { WorkspaceSelector } from "../../../workspaces/WorkspaceSelector.js";

/**
 * Draft/empty-chat context strip under the composer.
 * Narrower than the composer shell and tucked beneath it. Left: workspace selector;
 * right stays empty for now.
 */
export const ComposerDraftFooter: FC = () => {
	return (
		<div
			data-slot="aui_composer-draft-footer"
			data-qa-id="kilo-composer-draft-footer"
			className="border-border/60 relative z-0 mx-auto -mt-3 flex w-[calc(100%-2.75rem)] items-center justify-between gap-2 rounded-b-2xl border border-t-0 bg-(--composer-bg) px-1 pt-4 pb-1 dark:bg-[color-mix(in_oklab,var(--composer-bg),black_8%)]"
		>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<WorkspaceSelector />
			</div>
			<div className="flex shrink-0 items-center justify-end gap-2" />
		</div>
	);
};
