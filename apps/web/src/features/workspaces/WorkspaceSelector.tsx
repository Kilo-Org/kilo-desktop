import {
	ChevronDownIcon,
	FolderIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@anaconda-agentic-desktop/ui/components/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@anaconda-agentic-desktop/ui/components/popover";

import { useWorkspacesFeature } from "./WorkspacesFeatureProvider";

const NO_COMMAND_SELECTION = "__no-workspace-command-selection__";

// Workspace items carry their name as a keyword so search matches names, never the uuid value.
function filterWorkspaceItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

export function WorkspaceSelector() {
	const {
		workspaces,
		activeWorkspaceId,
		setActiveWorkspaceId,
		isLoading,
		isUnavailable,
		openCreate,
		openEdit,
		openDelete,
	} = useWorkspacesFeature();
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(NO_COMMAND_SELECTION);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
	const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

	const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
		}
	};

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) setCommandValue(NO_COMMAND_SELECTION);
				setOpen(nextOpen);
				if (!nextOpen) requestAnimationFrame(() => triggerRef.current?.focus());
			}}
		>
			<PopoverTrigger
				render={
					<Button
						ref={triggerRef}
						type="button"
						variant="ghost"
						size="sm"
						className="hover:bg-accent aria-expanded:bg-accent dark:hover:bg-muted dark:aria-expanded:bg-muted h-7 max-w-56 rounded-full"
						role="combobox"
						aria-expanded={open}
						aria-label="Select workspace"
						onKeyDown={onTriggerKeyDown}
					/>
				}
			>
				<FolderIcon data-icon="inline-start" />
				<span className="truncate">
					{active?.name ?? (isLoading ? "Loading workspaces…" : "Select workspace")}
				</span>
				<ChevronDownIcon data-icon="inline-end" className="opacity-60" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={6}
				collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
				className="w-64 gap-0 p-0"
				onKeyDown={(event) => {
					if (event.key === "Escape") setOpen(false);
				}}
			>
				<Command
					label="Search workspaces"
					value={commandValue}
					onValueChange={setCommandValue}
					filter={filterWorkspaceItems}
				>
					<CommandInput placeholder="Search workspaces…" />
					<CommandSeparator />
					<CommandList>
						{workspaces.length > 0 ? <CommandEmpty>No workspaces found.</CommandEmpty> : null}
						<CommandGroup>
							{isLoading ? (
								<div className="text-muted-foreground px-2 py-3 text-sm">Loading workspaces…</div>
							) : null}
							{isUnavailable ? (
								<div className="text-muted-foreground px-2 py-3 text-sm">
									Workspaces are unavailable.
								</div>
							) : null}
							{!isLoading && !isUnavailable && workspaces.length === 0 ? (
								<div className="text-muted-foreground px-2 py-3 text-sm">No workspaces yet.</div>
							) : null}
							{workspaces.map((workspace) => (
								<CommandItem
									key={workspace.id}
									value={workspace.id}
									keywords={[workspace.name]}
									onSelect={() => {
										setActiveWorkspaceId(workspace.id);
										setOpen(false);
									}}
									className="pr-1"
									data-checked={activeWorkspaceId === workspace.id}
								>
									<FolderIcon />
									<span className="min-w-0 flex-1 truncate">{workspace.name}</span>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													className="opacity-0 group-hover/command-item:opacity-100 group-data-[selected=true]/command-item:opacity-100 focus-visible:opacity-100"
													aria-label={`Workspace actions for ${workspace.name}`}
													onPointerDown={stop}
													onKeyDown={stop}
													onClick={stop}
												/>
											}
										>
											<MoreHorizontalIcon />
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="end"
											onPointerDown={stop}
											onKeyDown={stop}
											onClick={stop}
										>
											<DropdownMenuItem
												onClick={() => {
													setOpen(false);
													openEdit(workspace);
												}}
											>
												<PencilIcon />
												Edit
											</DropdownMenuItem>
											<DropdownMenuItem
												variant="destructive"
												onClick={() => {
													setOpen(false);
													openDelete(workspace);
												}}
											>
												<Trash2Icon />
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
					<CommandSeparator />
					<CommandGroup forceMount>
						<CommandItem
							value="create-workspace"
							onSelect={() => {
								setOpen(false);
								openCreate();
							}}
						>
							<PlusIcon />
							Create workspace
						</CommandItem>
					</CommandGroup>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
