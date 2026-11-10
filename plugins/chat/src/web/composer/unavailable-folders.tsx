import { TriangleAlertIcon } from "lucide-react";
import type { FC } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import { EDIT_WORKSPACE_COMMAND, Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { ComposerActionImplementation, ComposerContext } from "../../contracts";

const selectState = (state: DomainObjectState<typeof Workspaces>) => state;

function useWorkspaceWithUnavailableFolders(workspaceId: string | null) {
	const state = useDomainObjectState(Workspaces, selectState);
	if (!workspaceId || !state) return undefined;
	const unavailable = new Set(state.unavailableFolderIds);
	const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
	return workspace?.folders.some((folder) => unavailable.has(folder.id)) ? workspace : undefined;
}

/**
 * A warning beside the chat's workspace when kilo.work-sessions can't find
 * some of its folders; opens the workspace's settings to fix them.
 */
const UnavailableFoldersIndicator: FC<ComposerContext & { compact: boolean }> = ({
	workspaceId,
	compact,
}) => {
	const kernel = useKernel();
	const workspace = useWorkspaceWithUnavailableFolders(workspaceId);
	if (!workspace) return null;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size={compact ? "icon-xs" : "icon-sm"}
						className="text-warning shrink-0"
						aria-label={`${workspace.name} has unavailable folders`}
						data-qa-id="kilo-composer-unavailable-folders"
						onClick={() =>
							void kernel.commands
								.execute(EDIT_WORKSPACE_COMMAND, { workspaceId: workspace.id })
								.catch(() => undefined)
						}
					/>
				}
			>
				<TriangleAlertIcon aria-hidden="true" />
			</TooltipTrigger>
			<TooltipContent>
				Some workspace folders are unavailable. Open workspace settings to fix them.
			</TooltipContent>
		</Tooltip>
	);
};

export const unavailableFoldersFooterAction: ComposerActionImplementation = {
	kind: "view",
	Component: (context) => <UnavailableFoldersIndicator {...context} compact />,
};

export const unavailableFoldersDraftAction: ComposerActionImplementation = {
	kind: "view",
	Component: (context) => <UnavailableFoldersIndicator {...context} compact={false} />,
};
