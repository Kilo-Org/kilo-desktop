import { PaneTabTooltip } from "./PaneTabTooltip.js";
import { BotIcon, PlusIcon } from "lucide-react";
import { useContext, type FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { KiloAuthContext } from "../../account/KiloAuthContext.js";
import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";

/**
 * Whether the user is signed out of Kilo. Read from the context directly so a
 * tree without the auth provider (isolated renders) gates nothing.
 */
function useSignedOut(): boolean {
	const auth = useContext(KiloAuthContext);
	return auth !== null && auth.authenticated !== true;
}

export const PaneAddTab: FC<{
	definitions: readonly RightPanelTabDefinition[];
	onLaunchChat: () => void;
	onLaunch: (definition: RightPanelTabDefinition) => void;
	showChat?: boolean;
	placement?: "tab" | "toolbar";
}> = ({ definitions, onLaunchChat, onLaunch, showChat = true, placement = "tab" }) => {
	const signedOut = useSignedOut();
	const launchers = definitions.filter((definition) => definition.addable);
	const isToolbar = placement === "toolbar";
	const label = isToolbar ? "Add tab group" : "Add tab";
	const trigger = (
		<DropdownMenuTrigger
			render={<Button variant={isToolbar ? "outline" : "ghost"} size="icon-sm" />}
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
				{showChat ? (
					<DropdownMenuItem
						data-qa-id={isToolbar ? "chat-pane-launch-chat" : "chat-pane-add-menu-chat"}
						onClick={onLaunchChat}
					>
						<BotIcon className="text-muted-foreground size-3" />
						Chat
					</DropdownMenuItem>
				) : null}
				{launchers.map((definition) => {
					const qaId = isToolbar
						? `chat-pane-launch-${definition.id}`
						: `chat-pane-add-menu-${definition.id}`;
					const item = (
						<DropdownMenuItem
							key={definition.id}
							data-qa-id={qaId}
							onClick={() => onLaunch(definition)}
						>
							<definition.Icon className="size-3" />
							{definition.title}
						</DropdownMenuItem>
					);
					return definition.requiresSignIn && signedOut ? (
						<SignInRequiredItem key={definition.id} definition={definition} qaId={qaId} />
					) : (
						item
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * A launcher that needs a Kilo sign-in, shown greyed out while signed out. The
 * disabled item ignores the pointer, so the tooltip hangs off a wrapper.
 */
const SignInRequiredItem: FC<{ definition: RightPanelTabDefinition; qaId: string }> = ({
	definition,
	qaId,
}) => {
	const hint = definition.signInHint ?? `Sign in to Kilo to use ${definition.title}.`;
	return (
		<Tooltip>
			<TooltipTrigger render={<div data-qa-id={`${qaId}-signin-required`} />}>
				<DropdownMenuItem disabled aria-description={hint} data-qa-id={qaId}>
					<definition.Icon className="size-3" />
					{definition.title}
				</DropdownMenuItem>
			</TooltipTrigger>
			<TooltipContent side="right">{hint}</TooltipContent>
		</Tooltip>
	);
};
