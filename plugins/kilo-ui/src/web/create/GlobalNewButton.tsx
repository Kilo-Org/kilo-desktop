import { ChevronDownIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";

import { useAui } from "@assistant-ui/react";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { buttonVariants } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { navigateToChat } from "../chat/chat-navigation.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";

export function GlobalNewButton() {
	const aui = useAui();
	const sdk = useSdk("kilo-ui");
	const { openCreate } = useWorkspacesFeature();

	const createChat = () => {
		void aui.threads.switchToNewThread();
		navigateToChat(sdk);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="New"
				data-slot="aui_thread-list-new"
				data-qa-id="global-new"
				className={cn(buttonVariants({ variant: "default" }), "w-full justify-start")}
			>
				<PlusIcon data-slot="aui_thread-list-new-icon" />
				<span data-slot="aui_thread-list-new-label">New</span>
				<ChevronDownIcon
					data-slot="aui_thread-list-new-chevron"
					className="ml-auto size-3.5 opacity-80"
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side="right"
				align="start"
				sideOffset={8}
				className="w-48"
				aria-label="Create new"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel className="text-muted-foreground px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
						New
					</DropdownMenuLabel>
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
