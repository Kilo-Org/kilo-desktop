import { ChevronDownIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { useRef } from "react";

import { useAui } from "@assistant-ui/react";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { ButtonGroup } from "@anaconda-agentic-desktop/ui/components/button-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { navigateToChat } from "../chat/chat-navigation.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";

const newButtonHoverClassName = "group-hover/new:bg-foreground/5";

export function GlobalNewButton() {
	const aui = useAui();
	const sdk = useSdk("kilo-ui");
	const { openCreate } = useWorkspacesFeature();
	const field = useRef<HTMLDivElement>(null);

	const createChat = () => {
		void aui.threads.switchToNewThread();
		navigateToChat(sdk);
	};

	return (
		<DropdownMenu>
			<ButtonGroup ref={field} className="group/new w-full" aria-label="New">
				<Button
					type="button"
					variant="ghost"
					className={cn("min-w-0 flex-1 justify-start", newButtonHoverClassName)}
					aria-label="New Chat"
					data-slot="aui_thread-list-new"
					data-qa-id="global-new"
					onClick={createChat}
				>
					<PlusIcon data-icon="inline-start" data-slot="aui_thread-list-new-icon" />
					<span data-slot="aui_thread-list-new-label">New Chat</span>
				</Button>
				<DropdownMenuTrigger
					aria-label="Create new"
					aria-haspopup="menu"
					data-slot="aui_thread-list-new-more"
					data-qa-id="global-new-more"
					render={
						<Button type="button" variant="ghost" size="icon" className={newButtonHoverClassName} />
					}
				>
					<ChevronDownIcon data-slot="aui_thread-list-new-chevron" />
				</DropdownMenuTrigger>
			</ButtonGroup>
			<DropdownMenuContent align="start" anchor={field}>
				<DropdownMenuGroup>
					<DropdownMenuItem data-qa-id="global-new-chat" onClick={createChat}>
						<MessageSquareIcon />
						Chat
					</DropdownMenuItem>
					<DropdownMenuItem data-qa-id="global-new-workspace" onClick={openCreate}>
						<FolderIcon />
						Workspace
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
