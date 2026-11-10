import type { FC, ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { PaneAddTab } from "./PaneAddTab";
import type { CanvasPaneKind } from "../shared/pane-kinds";

/**
 * The session header's "+" menu, then a button for each kind pinned to the
 * header. `menuFor` gives a pinned kind's contributed menu entries, if any
 * (kilo.workbench/pane-kind-menu): its button then opens a menu, "New <kind>"
 * first, instead of launching.
 */
export const PaneLaunchToolbar: FC<{
	kinds: readonly CanvasPaneKind[];
	onLaunch: (kind: CanvasPaneKind) => void;
	menuFor?: (kind: CanvasPaneKind) => ReactNode;
}> = ({ kinds, onLaunch, menuFor }) => {
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
			{pinned.map((kind) => {
				const menu = kind.unavailableHint ? null : menuFor?.(kind);
				return menu ? (
					<PinnedKindMenu key={kind.id} kind={kind} onLaunch={onLaunch}>
						{menu}
					</PinnedKindMenu>
				) : (
					<PinnedKindButton key={kind.id} kind={kind} onLaunch={onLaunch} />
				);
			})}
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

const PinnedKindMenu: FC<{
	kind: CanvasPaneKind;
	onLaunch: (kind: CanvasPaneKind) => void;
	children: ReactNode;
}> = ({ kind, onLaunch, children }) => (
	<DropdownMenu>
		<Tooltip>
			<TooltipTrigger
				render={
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={kind.title}
								data-qa-id={`chat-pane-pinned-${kind.id}`}
							/>
						}
					/>
				}
			>
				<kind.Icon className="size-3.5" aria-hidden />
			</TooltipTrigger>
			<TooltipContent side="bottom">{kind.title}</TooltipContent>
		</Tooltip>
		<DropdownMenuContent
			align="end"
			className="w-64"
			data-qa-id={`chat-pane-pinned-menu-${kind.id}`}
		>
			<DropdownMenuItem
				data-qa-id={`chat-pane-pinned-new-${kind.id}`}
				onClick={() => onLaunch(kind)}
			>
				<kind.Icon aria-hidden />
				New {kind.title.toLowerCase()}
			</DropdownMenuItem>
			{children}
		</DropdownMenuContent>
	</DropdownMenu>
);
