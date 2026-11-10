import { PlusIcon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { PaneTabTooltip } from "./PaneTabTooltip";
import type { CanvasPaneKind } from "../shared/pane-kinds";

export const PaneAddTab: FC<{
	kinds: readonly CanvasPaneKind[];
	onLaunch: (kind: CanvasPaneKind) => void;
	placement?: "tab" | "toolbar";
}> = ({ kinds, onLaunch, placement = "tab" }) => {
	const isToolbar = placement === "toolbar";
	const launchers = kinds.filter(
		(kind) => kind.addable && (isToolbar || kind.inTabGroups !== false),
	);
	const label = isToolbar ? "Add tab group" : "Add tab";
	const trigger = (
		<DropdownMenuTrigger
			render={<Button variant="ghost" size="icon-sm" />}
			aria-label={label}
			aria-haspopup="menu"
			data-qa-id={isToolbar ? "chat-pane-toolbar-add" : "chat-pane-add-tab"}
			className={
				isToolbar
					? undefined
					: "text-muted-foreground opacity-0 transition-opacity group-focus-within/pane-tabs:opacity-100 group-hover/pane-tabs:opacity-100 group-data-[selected]/pane-tabs:opacity-100 data-popup-open:opacity-100"
			}
		>
			<PlusIcon className="size-3.5" aria-hidden />
		</DropdownMenuTrigger>
	);

	return (
		<DropdownMenu>
			{isToolbar ? (
				<Tooltip>
					<TooltipTrigger render={trigger} />
					<TooltipContent side="bottom">{label}</TooltipContent>
				</Tooltip>
			) : (
				<PaneTabTooltip content={label}>{trigger}</PaneTabTooltip>
			)}
			<DropdownMenuContent
				align={isToolbar ? "end" : "start"}
				side="bottom"
				className="w-auto min-w-36"
				data-qa-id="chat-pane-add-menu"
			>
				{launchers.map((kind) => {
					const qaId = isToolbar ? `chat-pane-launch-${kind.id}` : `chat-pane-add-menu-${kind.id}`;
					return kind.unavailableHint ? (
						<UnavailableItem key={kind.id} kind={kind} hint={kind.unavailableHint} qaId={qaId} />
					) : (
						<DropdownMenuItem key={kind.id} data-qa-id={qaId} onClick={() => onLaunch(kind)}>
							<kind.Icon className="size-3" />
							{kind.title}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/** The disabled item ignores the pointer, so the tooltip hangs off a wrapper. */
const UnavailableItem: FC<{ kind: CanvasPaneKind; hint: string; qaId: string }> = ({
	kind,
	hint,
	qaId,
}) => (
	<Tooltip>
		<TooltipTrigger render={<div data-qa-id={`${qaId}-unavailable`} />}>
			<DropdownMenuItem disabled aria-description={hint} data-qa-id={qaId}>
				<kind.Icon className="size-3" />
				{kind.title}
			</DropdownMenuItem>
		</TooltipTrigger>
		<TooltipContent side="right">{hint}</TooltipContent>
	</Tooltip>
);
