import {
	CheckIcon,
	FolderIcon,
	FolderXIcon,
	LayoutGridIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import {
	cloneElement,
	createContext,
	use,
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
import { workspaceGlyphColor } from "./workspace-glyph-style";

const NO_COMMAND_SELECTION = "__no-workspace-command-selection__";
const UNSCOPED_COMMAND_VALUE = "dont-work-in-a-workspace";
const ALL_WORKSPACES_COMMAND_VALUE = "all-workspaces";

/** Hide CommandItem's built-in check — opacity-0 still reserves layout space. */
const HIDE_BUILTIN_CHECK = "[&>svg:last-child]:hidden";

type PopoverAlign = "start" | "center" | "end";

// Workspace items carry their name as a keyword so search matches names, never the uuid value.
function filterWorkspaceItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

function getWorkspaceTriggerLabel(
	active: Workspace | undefined,
	isLoading: boolean,
	emptyLabel?: string,
): string {
	if (active) return active.name;
	if (isLoading) return "Loading workspaces…";
	return emptyLabel ?? "Select workspace";
}

type WorkspacePickerContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
	onTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	active: Workspace | undefined;
	isLoading: boolean;
	triggerLabel: string;
};

const WorkspacePickerContext = createContext<WorkspacePickerContextValue | null>(null);

export function useWorkspacePicker(): WorkspacePickerContextValue {
	const value = use(WorkspacePickerContext);
	if (!value) {
		throw new Error("WorkspacePicker components must be used within WorkspacePickerRoot.");
	}
	return value;
}

export function WorkspacePickerRoot({
	children,
	contentAlign = "start",
	contentWidth = "max",
	emptyLabel,
	includeUnscoped = true,
	value,
	onValueChange,
}: {
	children: ReactNode;
	contentAlign?: PopoverAlign;
	contentWidth?: "max" | "trigger";
	emptyLabel?: string;
	includeUnscoped?: boolean;
	value?: string | null;
	onValueChange?: (workspaceId: string | null) => void;
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
	const selectedId = onValueChange ? (value ?? null) : activeWorkspaceId;
	const active = workspaces.find((workspace) => workspace.id === selectedId);
	const isUnscoped = selectedId === null;
	const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();
	const triggerLabel = getWorkspaceTriggerLabel(active, isLoading, emptyLabel);

	const select = (workspaceId: string | null) => {
		if (onValueChange) onValueChange(workspaceId);
		else setActiveWorkspaceId(workspaceId);
		setOpen(false);
	};

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
				}}
			>
				{children}
				<PopoverContent
					align={contentAlign}
					side="bottom"
					sideOffset={6}
					collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
					className={
						contentWidth === "trigger" ? "w-(--anchor-width) gap-0 p-0" : "w-max min-w-64 gap-0 p-0"
					}
					onKeyDown={(event) => {
						if (event.key === "Escape") setOpen(false);
					}}
				>
					<Command
						label="Search workspaces"
						value={commandValue}
						onValueChange={setCommandValue}
						filter={filterWorkspaceItems}
						className="[&_[data-slot=command-input-wrapper]]:gap-1.5 [&_[data-slot=command-input-wrapper]]:px-2 [&_[data-slot=command-input-wrapper]]:py-2 [&_[data-slot=command-item]]:gap-1.5 [&_[data-slot=command-item]]:rounded-md [&_[data-slot=command-item]]:px-1.5 [&_[data-slot=command-item]]:py-1 [&_[data-slot=command-item]_[data-slot=button]]:size-5 [&_[data-slot=command-item]_span:has(>svg.lucide-check)]:size-5"
					>
						<CommandInput placeholder="Search workspaces…" />
						<CommandSeparator />
						<CommandList className="scroll-fade max-h-[calc(1.75rem*5+0.5rem)]">
							{workspaces.length > 0 ? <CommandEmpty>No workspaces found.</CommandEmpty> : null}
							<CommandGroup>
								{emptyLabel ? (
									<CommandItem
										data-qa-id="workspace-all-command"
										value={ALL_WORKSPACES_COMMAND_VALUE}
										keywords={[emptyLabel]}
										onSelect={() => select(null)}
										className={HIDE_BUILTIN_CHECK}
										data-checked={isUnscoped}
									>
										<LayoutGridIcon />
										<span className="min-w-0 flex-1 truncate">{emptyLabel}</span>
										{isUnscoped ? (
											<span className="flex size-6 shrink-0 items-center justify-center">
												<CheckIcon className="size-3.5" />
											</span>
										) : null}
									</CommandItem>
								) : null}
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
								{workspaces.map((workspace) => {
									const isSelected = selectedId === workspace.id;
									const glyph = workspaceGlyphColor(workspace.color);
									return (
										<CommandItem
											key={workspace.id}
											value={workspace.id}
											keywords={[workspace.name]}
											onSelect={() => select(workspace.id)}
											className={HIDE_BUILTIN_CHECK}
											data-checked={isSelected}
										>
											<span
												className="flex size-4 shrink-0 items-center justify-center"
												aria-hidden
											>
												<FolderIcon
													className={glyph ? "size-4" : "text-muted-foreground size-4"}
													{...(glyph ? { color: glyph } : {})}
												/>
											</span>
											<span className="min-w-0 flex-1 truncate">{workspace.name}</span>
											<span className="flex shrink-0 items-center gap-0.5">
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
												{isSelected ? (
													<span className="flex size-6 items-center justify-center">
														<CheckIcon className="size-3.5" />
													</span>
												) : null}
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
						<CommandSeparator />
						<CommandGroup forceMount>
							<CommandItem
								data-qa-id="workspace-create-command"
								value="create-workspace"
								className={HIDE_BUILTIN_CHECK}
								onSelect={() => {
									setOpen(false);
									openCreate();
								}}
							>
								<PlusIcon />
								Create workspace
							</CommandItem>
							{includeUnscoped ? (
								<CommandItem
									data-qa-id="workspace-unscoped-command"
									value={UNSCOPED_COMMAND_VALUE}
									keywords={["Don't work in a workspace", "unscoped"]}
									className={HIDE_BUILTIN_CHECK}
									onSelect={() => select(null)}
									data-checked={isUnscoped}
								>
									<FolderXIcon />
									<span className="whitespace-nowrap">Don't work in a workspace</span>
									{isUnscoped ? (
										<span className="flex size-6 shrink-0 items-center justify-center">
											<CheckIcon className="size-3.5" />
										</span>
									) : null}
								</CommandItem>
							) : null}
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

export function WorkspacePickerTrigger({
	children,
	render,
	"aria-label": ariaLabel = "Select workspace",
}: {
	children: ReactNode;
	render: ReactElement<TriggerRenderProps>;
	"aria-label"?: string;
}) {
	const { open, onTriggerKeyDown } = useWorkspacePicker();
	const existingKeyDown = render.props.onKeyDown;

	const trigger = cloneElement(render, {
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
