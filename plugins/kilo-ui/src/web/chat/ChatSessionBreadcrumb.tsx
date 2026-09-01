import { useAuiState } from "@assistant-ui/react";
import { FolderIcon } from "lucide-react";
import type { FC } from "react";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@anaconda-agentic-desktop/ui/components/breadcrumb";

import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { workspaceGlyphStyle } from "../workspaces/workspace-glyph-style.js";
import { resolveSessionLocationLabel } from "./session-activity/session-activity-logic.js";
import { useSessionActivity } from "./session-activity/SessionActivityProvider.js";

/**
 * Chat-page breadcrumb. Shows workspace → session when a non-draft session
 * is in a workspace; unscoped sessions show only the title.
 */
export const ChatSessionBreadcrumb: FC = () => {
	const status = useAuiState((s) => s.threadListItem.status);
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);
	const sessionTitle = useAuiState((s) => s.threadListItem.title);
	const activity = useSessionActivity((s) => (remoteId ? s.sessions[remoteId] : undefined));
	const { workspaces } = useWorkspacesFeature();

	if (status === "new") return null;

	const locationLabel = resolveSessionLocationLabel(activity, workspaces);
	const workspace = workspaces.find((candidate) => candidate.id === activity?.workspaceId);
	const title = sessionTitle?.trim() || "New Chat";

	return (
		<Breadcrumb data-qa-id="chat-session-breadcrumb" className="min-w-0">
			<BreadcrumbList className="flex-nowrap">
				{locationLabel ? (
					<>
						<BreadcrumbItem className="min-w-0">
							<span className="inline-flex min-w-0 items-center gap-1.5">
								<FolderIcon
									aria-hidden
									className="text-muted-foreground size-3.5 shrink-0"
									style={workspaceGlyphStyle(workspace?.color)}
								/>
								<span className="truncate">{locationLabel}</span>
							</span>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
					</>
				) : null}
				<BreadcrumbItem className="min-w-0">
					<BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	);
};
