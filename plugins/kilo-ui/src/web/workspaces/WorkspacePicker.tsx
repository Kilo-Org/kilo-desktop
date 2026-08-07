import {
	FolderIcon,
	FolderXIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import {
	cloneElement,
	createContext,
	use,
	useRef,
	useState,
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
} from "react";

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

import type { Workspace } from "../../contracts/workspaces/schemas.js";
import { useWorkspacesFeature } from "./WorkspacesFeatureContext";

const NO_COMMAND_SELECTION = "__no-workspace-command-selection__";
const UNSCOPED_COMMAND_VALUE = "dont-work-in-a-workspace";

type PopoverAlign = "start" | "center" | "end";

// Workspace items carry their name as a keyword so search matches names, never the uuid value.
function filterWorkspaceItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

export function getWorkspaceTriggerLabel(
	active: Workspace | undefined,
	isLoading: boolean,
): string {
	if (active) return active.name;
	if (isLoading) return "Loading workspaces…";
	return "Select workspace";
}

type WorkspacePickerContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
	triggerRef: { current: HTMLButtonElement | null };
	onTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	active: Workspace | undefined;
	isLoading: boolean;
	triggerLabel: string;
};

const WorkspacePickerContext = createContext<WorkspacePickerContextValue | null>(null);

function useWorkspacePicker(): WorkspacePickerContextValue {
	const value = use(WorkspacePickerContext);
	if (!value) {
		throw new Error("WorkspacePicker components must be used within WorkspacePicker.Root.");
	}
	return value;
}

function WorkspacePickerRoot({
	children,
	contentAlign = "start",
}: {
	children: ReactNode;
	contentAlign?: PopoverAlign;
}) {
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
	const isUnscoped = activeWorkspaceId === null;
	const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();
	const triggerLabel = getWorkspaceTriggerLabel(active, isLoading);

	const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
		}
	};

	return (
		<WorkspacePickerContext
			value={{
				open,
				setOpen,
				triggerRef,
				onTriggerKeyDown,
				active,
				isLoading,
				triggerLabel,
			}}
		>
			<Popover
				open={open}
				onOpenChange={(nextOpen) => {
					if (nextOpen) setCommandValue(NO_COMMAND_SELECTION);
					setOpen(nextOpen);
					if (!nextOpen) requestAnimationFrame(() => triggerRef.current?.focus());
				}}
			>
				{children}
				<PopoverContent
					align={contentAlign}
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
						<CommandList className="scroll-fade max-h-[calc(2rem*4+0.5rem)]">
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
								data-qa-id="workspace-create-command"
								value="create-workspace"
								onSelect={() => {
									setOpen(false);
									openCreate();
								}}
							>
								<PlusIcon />
								Create workspace
							</CommandItem>
							<CommandItem
								data-qa-id="workspace-unscoped-command"
								value={UNSCOPED_COMMAND_VALUE}
								keywords={["Don't work in a workspace", "unscoped"]}
								onSelect={() => {
									setActiveWorkspaceId(null);
									setOpen(false);
								}}
								data-checked={isUnscoped}
							>
								<FolderXIcon />
								Don't work in a workspace
							</CommandItem>
						</CommandGroup>
					</Command>
				</PopoverContent>
			</Popover>
		</WorkspacePickerContext>
	);
}

type TriggerRenderProps = {
	ref?: React.Ref<HTMLButtonElement>;
	role?: string;
	"aria-expanded"?: boolean;
	"aria-label"?: string;
	onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

function WorkspacePickerTrigger({
	children,
	render,
	"aria-label": ariaLabel = "Select workspace",
}: {
	children: ReactNode;
	render: ReactElement<TriggerRenderProps>;
	"aria-label"?: string;
}) {
	const { open, triggerRef, onTriggerKeyDown } = useWorkspacePicker();
	const existingKeyDown = render.props.onKeyDown;

	const trigger = cloneElement(render, {
		ref: triggerRef,
		role: "combobox",
		"aria-expanded": open,
		"aria-label": ariaLabel,
		onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
			onTriggerKeyDown(event);
			existingKeyDown?.(event);
		},
	});

	return <PopoverTrigger render={trigger}>{children}</PopoverTrigger>;
}

export const WorkspacePicker = {
	Root: WorkspacePickerRoot,
	Trigger: WorkspacePickerTrigger,
	usePicker: useWorkspacePicker,
};
