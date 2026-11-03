import {
	EllipsisIcon,
	FolderIcon,
	FolderXIcon,
	LayoutGridIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	TriangleAlertIcon,
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

import { Button } from "./button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "./command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** The parts of a workspace the picker shows. */
export interface PickerWorkspace {
	readonly id: string;
	readonly name: string;
	/** `#RRGGBB`. */
	readonly color?: string | undefined;
}

type Workspace = PickerWorkspace;

/**
 * Where the picker's workspaces and actions come from. Each host provides it
 * (the session list, the composer) so this stays a plain UI component.
 */
export interface WorkspacePickerSource {
	readonly workspaces: readonly PickerWorkspace[];
	readonly activeWorkspaceId: string | null;
	setActiveWorkspaceId(workspaceId: string | null): void;
	readonly isLoading: boolean;
	/** True where workspaces don't exist (browser mode). */
	readonly isUnavailable: boolean;
	hasUnavailableFolders(workspaceId: string): boolean;
	openCreate(): void;
	openEdit(workspace: PickerWorkspace): void;
	openDelete(workspace: PickerWorkspace): void;
}

const EMPTY_SOURCE: WorkspacePickerSource = {
	workspaces: [],
	activeWorkspaceId: null,
	setActiveWorkspaceId: () => {},
	isLoading: false,
	isUnavailable: true,
	hasUnavailableFolders: () => false,
	openCreate: () => {},
	openEdit: () => {},
	openDelete: () => {},
};

const WorkspacePickerSourceContext = createContext<WorkspacePickerSource>(EMPTY_SOURCE);

export const WorkspacePickerSourceProvider = WorkspacePickerSourceContext.Provider;

export function useWorkspacePickerSource(): WorkspacePickerSource {
	return use(WorkspacePickerSourceContext);
}

/** Normalised `#RRGGBB` for Lucide `color` (stroke); undefined leaves currentColor. */
export function workspaceGlyphColor(color: string | undefined): string | undefined {
	return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : undefined;
}

const NO_COMMAND_SELECTION = "__no-workspace-command-selection__";
const UNSCOPED_COMMAND_VALUE = "dont-work-in-a-workspace";
const ALL_WORKSPACES_COMMAND_VALUE = "all-workspaces";
const UNSCOPED_LABEL = "No workspace";

/** Hide CommandItem's built-in check — opacity-0 still reserves layout space. */

type PopoverAlign = "start" | "center" | "end";
type PopoverSide = "top" | "right" | "bottom" | "left";

// Workspace items carry their name as a keyword so search matches names, never the uuid value.
function filterWorkspaceItems(value: string, search: string, keywords?: string[]): number {
	const terms = keywords && keywords.length > 0 ? keywords : [value];
	const query = search.trim().toLowerCase();
	return terms.some((term) => term.toLowerCase().includes(query)) ? 1 : 0;
}

function getWorkspaceTriggerLabel({
	active,
	showUnscoped,
	isLoading,
	emptyLabel,
}: {
	active: Workspace | undefined;
	showUnscoped: boolean;
	isLoading: boolean;
	emptyLabel: string | undefined;
}): string {
	if (active) return active.name;
	if (showUnscoped) return UNSCOPED_LABEL;
	if (isLoading) return "Loading workspaces…";
	return emptyLabel ?? "Select workspace";
}

type WorkspacePickerContextValue = {
	open: boolean;
	setOpen: (open: boolean) => void;
	onTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	active: Workspace | undefined;
	isUnscoped: boolean;
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

function workspacePickerContentWidthClass(contentWidth: "max" | "fit" | "trigger"): string {
	switch (contentWidth) {
		case "fit":
			return "w-max min-w-0 gap-0 p-0";
		case "trigger":
			return "w-(--anchor-width) min-w-0 gap-0 p-0";
		case "max":
			return "w-max min-w-64 gap-0 p-0";
		default: {
			const _exhaustive: never = contentWidth;
			return _exhaustive;
		}
	}
}

export function WorkspacePickerRoot({
	children,
	contentAlign = "start",
	contentSide = "bottom",
	contentWidth = "max",
	emptyLabel,
	includeUnscoped = true,
	unscopedValue = null,
	value,
	onValueChange,
}: {
	children: ReactNode;
	contentAlign?: PopoverAlign;
	contentSide?: PopoverSide;
	contentWidth?: "max" | "fit" | "trigger";
	emptyLabel?: string;
	includeUnscoped?: boolean;
	/** What "No workspace" selects; set it when `null` already means "All" (`emptyLabel`). */
	unscopedValue?: string | null;
	value?: string | null;
	onValueChange?: (workspaceId: string | null) => void;
}) {
	const {
		workspaces,
		activeWorkspaceId,
		setActiveWorkspaceId,
		isLoading,
		isUnavailable,
		hasUnavailableFolders,
		openCreate,
		openEdit,
		openDelete,
	} = useWorkspacePickerSource();
	const [open, setOpen] = useState(false);
	const [commandValue, setCommandValue] = useState(NO_COMMAND_SELECTION);
	const selectedId = onValueChange ? (value ?? null) : activeWorkspaceId;
	const active = workspaces.find((workspace) => workspace.id === selectedId);
	const isUnscoped = selectedId === unscopedValue;
	const isEmpty = selectedId === null;
	const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();
	// With the default `null`, unscoped is indistinguishable from "nothing chosen".
	const triggerLabel = getWorkspaceTriggerLabel({
		active,
		showUnscoped: isUnscoped && unscopedValue !== null,
		isLoading,
		emptyLabel,
	});

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
				isUnscoped,
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
					side={contentSide}
					sideOffset={6}
					collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
					className={workspacePickerContentWidthClass(contentWidth)}
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
						<CommandInput placeholder="Search workspaces" />
						<CommandList className="scroll-fade max-h-[calc(1.75rem*5)]">
							{workspaces.length > 0 ? <CommandEmpty>No workspaces found.</CommandEmpty> : null}
							<CommandGroup>
								{emptyLabel ? (
									<CommandItem
										data-qa-id="workspace-all-command"
										value={ALL_WORKSPACES_COMMAND_VALUE}
										keywords={[emptyLabel]}
										onSelect={() => select(null)}
										data-checked={isEmpty}
									>
										<LayoutGridIcon />
										<span className="min-w-0 flex-1 truncate">{emptyLabel}</span>
									</CommandItem>
								) : null}
								{includeUnscoped ? (
									<CommandItem
										data-qa-id="workspace-unscoped-command"
										value={UNSCOPED_COMMAND_VALUE}
										keywords={[UNSCOPED_LABEL, "unscoped"]}
										onSelect={() => select(unscopedValue)}
										data-checked={isUnscoped}
									>
										<FolderXIcon />
										<span className="whitespace-nowrap">{UNSCOPED_LABEL}</span>
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
									const unavailableFolders = hasUnavailableFolders?.(workspace.id) ?? false;
									return (
										<CommandItem
											key={workspace.id}
											value={workspace.id}
											keywords={[workspace.name]}
											onSelect={() => select(workspace.id)}
											data-checked={isSelected}
										>
											<FolderIcon
												aria-hidden
												className={glyph ? undefined : "text-muted-foreground"}
												{...(glyph ? { color: glyph } : {})}
											/>
											<span className="min-w-0 flex-1 truncate">{workspace.name}</span>
											{/* -my-1: the 24px action sits in the row's padding so the row stays 28px. */}
											<span className="-my-1 flex shrink-0 items-center gap-0.5">
												{unavailableFolders ? (
													<Button
														type="button"
														variant="ghost"
														size="icon-xs"
														className="text-warning"
														data-qa-id="workspace-unavailable-folders-indicator"
														aria-label={`Unavailable folders: open ${workspace.name} settings`}
														onPointerDown={stop}
														onKeyDown={stop}
														onClick={(event) => {
															stop(event);
															setOpen(false);
															openEdit(workspace);
														}}
													>
														<TriangleAlertIcon />
													</Button>
												) : null}
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
														<EllipsisIcon />
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
											</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
						{/* Outside the list, so it must opt out of cmdk hiding it while filtering. */}
						<CommandSeparator alwaysRender />
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
								New workspace
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
