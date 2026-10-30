import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { useWorkspacesFeature } from "./WorkspacesFeatureContext.js";

type WorkspaceUnavailableFoldersIndicatorProps = {
	workspaceId?: string | undefined;
	compact?: boolean | undefined;
};

export function WorkspaceUnavailableFoldersIndicator({
	workspaceId,
	compact = false,
}: WorkspaceUnavailableFoldersIndicatorProps = {}) {
	const { activeWorkspaceId, hasUnavailableFolders, openEdit, workspaces } = useWorkspacesFeature();
	const effectiveWorkspaceId = workspaceId ?? activeWorkspaceId;
	const workspace = workspaces.find((candidate) => candidate.id === effectiveWorkspaceId);

	if (!workspace || !hasUnavailableFolders?.(workspace.id)) return null;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size={compact ? "icon-xs" : "icon-sm"}
						className="text-warning"
						aria-label={`${workspace.name} has unavailable folders`}
						data-qa-id="kilo-composer-unavailable-folders"
						onClick={() => openEdit(workspace)}
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
}
