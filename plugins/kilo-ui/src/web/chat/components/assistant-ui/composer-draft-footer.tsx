"use client";

import type { ComponentType, FC } from "react";

import { useSdkContributions } from "@kilo-desktop/sdk-react";

import { useWorkspaceDirectory } from "../../../session/workspace/use-workspace-directory.js";
import { useWorkspacesFeature } from "../../../workspaces/WorkspacesFeatureContext.js";
import { WorkspaceSelector } from "../../../workspaces/WorkspaceSelector.js";
import { WorkspaceUnavailableFoldersIndicator } from "../../../workspaces/WorkspaceUnavailableFoldersIndicator.js";

/**
 * Qualified id of the composer draft footer zone, owned by kilo-ui. Other
 * plugins contribute footer controls through `contributes.zones` entries
 * targeting this zone.
 */
export const CHAT_COMPOSER_DRAFT_FOOTER_ZONE = "kilo-ui/chat-composer-draft-footer";

/** Context kilo-ui supplies when it renders a draft-footer contribution. */
export interface ChatComposerDraftFooterContributionProps {
	/** Primary folder path of the active workspace; absent when unscoped. */
	readonly workspaceDirectory?: string | undefined;
	/** Id of the active workspace; absent when unscoped. */
	readonly workspaceId?: string | undefined;
}

/**
 * Draft/empty-chat context strip attached under the composer.
 * Same width as the composer; tucked so the composer's rounded bottom
 * corners sit on this surface. Left: workspace selector followed by
 * zone contributions; right stays empty for now.
 */
export const ComposerDraftFooter: FC = () => {
	const workspaceDirectory = useWorkspaceDirectory();
	const { activeWorkspaceId } = useWorkspacesFeature();
	const contributions = useSdkContributions(CHAT_COMPOSER_DRAFT_FOOTER_ZONE);

	return (
		<div
			data-slot="aui_composer-draft-footer"
			data-qa-id="kilo-composer-draft-footer"
			className="border-border-subtle bg-foreground/[0.06] dark:bg-muted relative z-0 -mt-(--composer-radius) flex w-full items-center justify-between gap-2 rounded-b-(--composer-radius) border border-t-0 px-1 pt-5 pb-1"
		>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<WorkspaceSelector />
				<WorkspaceUnavailableFoldersIndicator />
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
							workspaceDirectory={workspaceDirectory}
							workspaceId={activeWorkspaceId ?? undefined}
						/>
					);
				})}
			</div>
			<div className="flex shrink-0 items-center justify-end gap-2" />
		</div>
	);
};
