import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { useAui, useAuiState } from "@assistant-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState, type FC } from "react";

/** Tracks which (sessionId, boundaryId, workspace) combinations have already shown a notice in this app session. */
const shownNotices = new Set<string>();

import {
	useRevertBoundaryId,
	useRevertDiffs,
	useRevertedUserRows,
	useRevertWorkspace,
} from "./checkpoint-revert";
import { selectOpenCodeExtras } from "../runtime/use-optional-opencode-runtime-extras";
import { DiffStat, RevertMessageRows } from "./checkpoint-revert-messages";
import { COMPOSER_SHELF_CLASS, COMPOSER_SHELF_LIST_CLASS } from "../thread/composer-shelf";

// Mirrors the kilocode clients' non-restored revert.workspace states. The
// undefined case covers reverts performed by older CLIs/TUI that did not report status.
const WORKSPACE_NOT_RESTORED_COPY = {
	"snapshots-disabled":
		"Conversation reverted. File changes were not restored because snapshots are disabled.",
	unavailable:
		"Conversation reverted. No file checkpoint was available, so workspace changes were not restored.",
	"not-a-git-repo":
		"Conversation reverted. File changes were not restored because this folder is not a git repository.",
	legacy:
		"Conversation reverted. Workspace restoration status is unavailable for this earlier revert.",
} as const;

export const CheckpointRestoreControls: FC = () => {
	const aui = useAui();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const boundaryId = useRevertBoundaryId();
	const sessionId = useAuiState((s) => selectOpenCodeExtras(s.thread.extras)?.session?.id);
	const rows = useRevertedUserRows();
	const workspace = useRevertWorkspace();
	const diffs = useRevertDiffs();
	const workspaceNotice =
		workspace === undefined
			? WORKSPACE_NOT_RESTORED_COPY.legacy
			: workspace === "restored"
				? undefined
				: WORKSPACE_NOT_RESTORED_COPY[workspace];

	// `file` is optional in the wire type; entries without one cannot be listed.
	const files = (diffs ?? []).filter((diff) => diff.file !== undefined);
	const additions = files.reduce((total, diff) => total + diff.additions, 0);
	const deletions = files.reduce((total, diff) => total + diff.deletions, 0);
	const revertedCopy =
		rows.length === 1 ? "1 message reverted" : `${rows.length} messages reverted`;

	useEffect(() => {
		if (!workspaceNotice || !boundaryId) return;
		const key = `${sessionId ?? ""}:${boundaryId}:${workspace ?? "legacy"}`;
		if (shownNotices.has(key)) return;
		shownNotices.add(key);
		toast.warning(workspaceNotice);
	}, [workspaceNotice, boundaryId, workspace, sessionId]);

	const [isOpen, setIsOpen] = useState(false);
	const [isUndoing, setIsUndoing] = useState(false);
	const undo = async () => {
		const extras = selectOpenCodeExtras(aui.thread.getState().extras);
		if (!extras?.session?.revert?.messageID) return;
		setIsUndoing(true);
		try {
			await extras.unrevert();
			// Undo clears text only — attachments added by an earlier restore
			// stay in the composer (deliberate; extension clears all attachment kinds).
			aui.thread.composer().setText("");
		} catch {
			toast.error("Could not restore the reverted messages.");
		} finally {
			setIsUndoing(false);
		}
	};

	return (
		<Collapsible
			// The key remounts the Collapsible per boundary so the collapsed state
			// resets with each new revert (including Restore-forward moves).
			key={boundaryId ?? "none"}
			open={isOpen}
			onOpenChange={setIsOpen}
			className={COMPOSER_SHELF_CLASS}
		>
			<div
				className={cn(
					"relative flex h-8 w-full items-center",
					isOpen && rows.length > 0 && "border-border-subtle border-b",
				)}
			>
				{rows.length > 0 ? (
					<CollapsibleTrigger
						data-qa-id="kilo-revert-messages-toggle"
						render={
							<Button
								variant="ghost"
								className="text-muted-foreground hover:bg-muted/35 h-full min-w-0 flex-1 justify-start rounded-none bg-clip-border px-3 pr-28 text-xs font-medium"
							>
								<span>{revertedCopy}</span>
								{files.length > 0 && <DiffStat additions={additions} deletions={deletions} />}
								<ChevronDownIcon
									data-icon="inline-end"
									data-slot="revert-messages-chevron"
									className={cn(
										"ml-auto size-3.5 transition-transform duration-150",
										!isOpen && "-rotate-90",
									)}
								/>
							</Button>
						}
					/>
				) : (
					<div className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 px-3 text-xs font-medium">
						<span>{revertedCopy}</span>
						{files.length > 0 && <DiffStat additions={additions} deletions={deletions} />}
					</div>
				)}
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={isRunning || isUndoing}
					onClick={() => void undo()}
					data-qa-id="kilo-revert-undo-button"
					className={cn(
						"text-muted-foreground hover:text-foreground",
						rows.length > 0 ? "absolute right-[27px]" : "mr-1.5",
					)}
				>
					{isUndoing && <Spinner data-icon="inline-start" aria-hidden="true" />}
					Undo revert
				</Button>
			</div>
			{rows.length > 0 && (
				<CollapsibleContent className="w-full overflow-hidden">
					<div className={COMPOSER_SHELF_LIST_CLASS}>
						<RevertMessageRows aui={aui} rows={rows} isRunning={isRunning} />
					</div>
				</CollapsibleContent>
			)}
		</Collapsible>
	);
};
