import { useAuiState } from "@assistant-ui/react";
import { FolderIcon } from "lucide-react";
import type { FC } from "react";

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@kilo-desktop/ui/components/breadcrumb";

import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { workspaceGlyphStyle } from "../workspaces/workspace-glyph-style.js";
import { resolveSessionLocationLabel } from "./session-activity/session-activity-logic.js";
import { useSessionActivity } from "./session-activity/SessionActivityProvider.js";

export const ChatLocationBreadcrumb: FC<{
	locationLabel?: string | null;
	locationColor?: string;
	title: string;
	qaId: string;
	scale?: "compact" | "header";
}> = ({ locationLabel, locationColor, title, qaId, scale = "compact" }) => (
	<Breadcrumb data-qa-id={qaId} className="min-w-0">
		<BreadcrumbList className="flex-nowrap text-sm">
			{locationLabel ? (
				<>
					<BreadcrumbItem className="min-w-0">
						<span className="inline-flex min-w-0 items-center gap-1.5">
							<FolderIcon
								aria-hidden
								className={
									scale === "header"
										? "text-muted-foreground size-3.5 shrink-0"
										: "text-muted-foreground size-3 shrink-0"
								}
								style={workspaceGlyphStyle(locationColor)}
							/>
							<span className="truncate">{locationLabel}</span>
						</span>
					</BreadcrumbItem>
					<BreadcrumbSeparator className="[&>svg]:size-3" />
				</>
			) : null}
			<BreadcrumbItem className="min-w-0">
				<BreadcrumbPage className={scale === "header" ? "truncate font-medium" : "truncate"}>
					{title}
				</BreadcrumbPage>
			</BreadcrumbItem>
		</BreadcrumbList>
	</Breadcrumb>
);

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
		<ChatLocationBreadcrumb
			locationLabel={locationLabel}
			{...(workspace?.color ? { locationColor: workspace.color } : {})}
			title={title}
			qaId="chat-session-breadcrumb"
			scale="header"
		/>
	);
};
