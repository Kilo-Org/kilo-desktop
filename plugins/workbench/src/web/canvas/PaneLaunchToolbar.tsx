import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { PaneAddTab } from "./PaneAddTab";
import type { CanvasPaneKind } from "./types";

/** The session header's "+" menu, then a button for each kind pinned to the header. */
export const PaneLaunchToolbar: FC<{
	kinds: readonly CanvasPaneKind[];
	onLaunch: (kind: CanvasPaneKind) => void;
}> = ({ kinds, onLaunch }) => {
	const listed = kinds.filter((kind) => kind.addable && !kind.pinned);
	const pinned = kinds.filter((kind) => kind.addable && kind.pinned);
	return (
		<div
			className="flex h-7 shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
			data-qa-id="chat-pane-toolbar"
			role="toolbar"
			aria-label="Pane controls"
		>
			{listed.length > 0 ? (
				<PaneAddTab kinds={listed} onLaunch={onLaunch} placement="toolbar" />
			) : null}
			{pinned.map((kind) => (
				<PinnedKindButton key={kind.id} kind={kind} onLaunch={onLaunch} />
			))}
		</div>
	);
};

const PinnedKindButton: FC<{
	kind: CanvasPaneKind;
	onLaunch: (kind: CanvasPaneKind) => void;
}> = ({ kind, onLaunch }) => (
	<Tooltip>
		<TooltipTrigger
			render={
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={kind.title}
					// aria-disabled, not disabled, so the tooltip still explains why.
					aria-disabled={kind.unavailableHint ? true : undefined}
					data-qa-id={`chat-pane-pinned-${kind.id}`}
					onClick={kind.unavailableHint ? undefined : () => onLaunch(kind)}
				/>
			}
		>
			<kind.Icon className="size-3.5" aria-hidden />
		</TooltipTrigger>
		<TooltipContent side="bottom">{kind.unavailableHint ?? kind.title}</TooltipContent>
	</Tooltip>
);
