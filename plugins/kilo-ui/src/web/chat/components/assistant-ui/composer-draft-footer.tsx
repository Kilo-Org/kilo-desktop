"use client";

import type { ComponentType, FC } from "react";

import { useSdkContributions } from "@anaconda-agentic-desktop/sdk-react";

import { useWorkspaceDirectory } from "../../use-workspace-directory.js";
import { WorkspaceSelector } from "../../../workspaces/WorkspaceSelector.js";

/**
 * Qualified id of the composer draft footer zone, owned by kilo-ui. Other
 * plugins contribute footer controls through `contributes.zones` entries
 * targeting this zone.
 */
export const CHAT_COMPOSER_DRAFT_FOOTER_ZONE = "kilo-ui/chat-composer-draft-footer";

/** Context kilo-ui supplies when it renders a draft-footer contribution. */
export interface ChatComposerDraftFooterContributionProps {
	/** Primary folder path of the active workspace; absent when unscoped. */
	readonly workspaceDirectory?: string;
}

/**
 * Draft/empty-chat context strip under the composer.
 * Narrower than the composer shell and tucked beneath it. Left: workspace
 * selector followed by zone contributions; right stays empty for now.
 */
export const ComposerDraftFooter: FC = () => {
	const workspaceDirectory = useWorkspaceDirectory();
	const contributions = useSdkContributions(CHAT_COMPOSER_DRAFT_FOOTER_ZONE);

	return (
		<div
			data-slot="aui_composer-draft-footer"
			data-qa-id="kilo-composer-draft-footer"
			className="border-border dark:border-border/60 relative z-0 mx-auto -mt-3 flex w-[calc(100%-2.75rem)] items-center justify-between gap-2 rounded-b-xl border border-t-0 bg-(--composer-bg) px-1 pt-4 pb-1 dark:bg-[color-mix(in_oklab,var(--composer-bg),black_8%)]"
		>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<WorkspaceSelector />
				{contributions.map((contribution) => {
					if (typeof contribution.component !== "function") {
						console.warn(
							`[ComposerDraftFooter] Skipping contribution "${contribution.label}" from ` +
								`"${contribution.featureId}" in zone "${CHAT_COMPOSER_DRAFT_FOOTER_ZONE}": component is not a React component.`,
						);
						return null;
					}
					const Component =
						contribution.component as ComponentType<ChatComposerDraftFooterContributionProps>;
					return (
						<Component
							key={`${contribution.featureId}:${contribution.id}`}
							{...(workspaceDirectory === undefined ? {} : { workspaceDirectory })}
						/>
					);
				})}
			</div>
			<div className="flex shrink-0 items-center justify-end gap-2" />
		</div>
	);
};
