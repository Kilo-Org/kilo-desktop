import { Button } from "@kilo-desktop/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
} from "@kilo-desktop/ui/components/item";
import { toast } from "@kilo-desktop/ui/components/sonner";
import type { FC } from "react";

import { COMPOSER_SHELF_ROW_CLASS } from "../thread/composer-shelf";
import {
	restoreThroughUserMessage,
	type AuiClient,
	type RevertedUserRow,
} from "./checkpoint-revert";

// Raw green/red diff-stat colors are the deliberate exception to the semantic
// token rule — they mirror GitDiffHeader, the app's diff-stat convention.
export const DiffStat = ({ additions, deletions }: { additions: number; deletions: number }) => (
	<span className="shrink-0 text-xs tabular-nums">
		<span className="text-success">+{additions}</span>
		<span className="text-destructive ml-1">−{deletions}</span>
	</span>
);

const RevertMessageRow = ({
	aui,
	row,
	isRunning,
}: {
	aui: AuiClient;
	row: RevertedUserRow;
	isRunning: boolean;
}) => {
	const restore = async () => {
		try {
			await restoreThroughUserMessage(aui, row.id);
		} catch {
			toast.error("Could not restore the reverted messages.");
		}
	};
	return (
		<Item
			size="xs"
			role="listitem"
			data-qa-id="kilo-revert-message-row"
			className={COMPOSER_SHELF_ROW_CLASS}
		>
			<ItemContent className="min-w-0">
				<ItemDescription className="text-foreground/90 line-clamp-none truncate text-sm">
					{row.text === "" ? "(no text)" : row.text}
				</ItemDescription>
			</ItemContent>
			<ItemActions className="shrink-0 gap-1.5">
				{row.hasDiffs ? (
					<DiffStat additions={row.additions} deletions={row.deletions} />
				) : (
					<span className="text-muted-foreground text-2xs">No changes</span>
				)}
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={isRunning}
					onClick={() => void restore()}
					data-qa-id="kilo-revert-row-restore-button"
					className="text-muted-foreground hover:text-foreground opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
				>
					Restore to here
				</Button>
			</ItemActions>
		</Item>
	);
};

/** Bounded list of a pending revert's reverted user messages. */
export const RevertMessageRows: FC<{
	aui: AuiClient;
	rows: RevertedUserRow[];
	isRunning: boolean;
}> = ({ aui, rows, isRunning }) => {
	return (
		<ItemGroup
			aria-label="Reverted messages"
			data-qa-id="kilo-revert-messages-list"
			className="has-data-[size=xs]:gap-0"
		>
			{rows.map((row) => (
				<RevertMessageRow key={row.id} aui={aui} row={row} isRunning={isRunning} />
			))}
		</ItemGroup>
	);
};
