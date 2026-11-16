import { createContext, useContext, type MouseEvent } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { ExternalLinkIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { CopyButton } from "@kilo-desktop/ui/components/copy-button";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

export interface FileHeaderActionsValue {
	readonly writeText: (text: string) => Promise<void>;
	/** The absolute path to open for a repository-relative path; null hides Open. */
	readonly openTarget: (repositoryPath: string) => string | null;
	/** Opens an absolute path in the session (rejects when it can't). */
	readonly open: (path: string) => Promise<unknown>;
}

/**
 * What every file header's actions need from the pane. Headers render in
 * CodeView's slot portals, so this reaches them through React context; keep
 * the value memoized — a change re-renders every mounted header.
 */
export const FileHeaderActionsContext = createContext<FileHeaderActionsValue | null>(null);

const showCopyError = () => toast.error("Couldn't copy the path");

/** Copy path and Open file for one file's diff header (CodeView's `header-filename-suffix` slot). */
export function FileHeaderActions({ fileDiff }: { readonly fileDiff: FileDiffMetadata }) {
	const actions = useContext(FileHeaderActionsContext);
	if (!actions) return null;
	const target = fileDiff.type === "deleted" ? null : actions.openTarget(fileDiff.name);
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<CopyButton
				data-qa-id="git-diff-file-copy-path"
				label="Copy path"
				onError={showCopyError}
				value={fileDiff.name}
				writeText={actions.writeText}
			/>
			{target === null ? null : <OpenFileButton open={actions.open} path={target} />}
		</div>
	);
}

function OpenFileButton({
	open,
	path,
}: {
	readonly open: FileHeaderActionsValue["open"];
	readonly path: string;
}) {
	const onClick = (event: MouseEvent) => {
		event.stopPropagation();
		open(path).catch((error: unknown) =>
			toast.error("Couldn't open the file", {
				description: error instanceof Error ? error.message : undefined,
			}),
		);
	};
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label="Open file"
						data-qa-id="git-diff-file-open"
						onClick={onClick}
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<ExternalLinkIcon aria-hidden="true" />
			</TooltipTrigger>
			<TooltipContent side="bottom">Open file</TooltipContent>
		</Tooltip>
	);
}
