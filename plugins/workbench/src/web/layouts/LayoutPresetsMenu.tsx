import {
	CheckIcon,
	PanelsTopLeftIcon,
	PencilIcon,
	SaveIcon,
	StarIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Empty, EmptyHeader, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { toast } from "@kilo-desktop/ui/components/sonner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	Layouts,
	type LayoutPreset,
	type LayoutsState,
	type SessionActionProps,
} from "../../contracts";
import { sessionPanesOf } from "../panes/pane-actions";
import { usePaneKinds } from "../panes/use-pane-kinds";
import { useWorkbenchTelemetry } from "../telemetry";
import {
	applyLayoutTemplate,
	captureLayoutTemplate,
	type CapturedTemplate,
} from "./layout-template";

const selectState = (state: LayoutsState) => state;

const messageOf = (reason: unknown, fallback: string) =>
	reason instanceof Error ? reason.message : fallback;

function LayoutAction({
	label,
	qaId,
	disabled,
	onClick,
	children,
	destructive = false,
}: {
	label: string;
	qaId: string;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
	destructive?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						data-qa-id={qaId}
						disabled={disabled}
						onClick={onClick}
						className={destructive ? "hover:text-destructive" : undefined}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/** One layout action at a time, with its failure kept for the open dialog or a toast. */
function useLayoutAction() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = (operation: () => Promise<unknown>, onSuccess?: () => void) => {
		setError(null);
		setPending(true);
		void operation()
			.then(
				() => onSuccess?.(),
				(reason: unknown) => setError(messageOf(reason, "The layout action failed.")),
			)
			.finally(() => setPending(false));
	};
	return { pending, error, setError, run };
}

/**
 * The open session's Layouts menu (a kilo.workbench/session-action): apply a
 * saved preset, save the current panes as one, and manage presets (update,
 * rename, default for new sessions, delete). Hidden without kilo.workbench's
 * main (browser mode).
 */
export function LayoutPresetsMenu({ session }: SessionActionProps) {
	const layouts = useDomain(Layouts);
	const state = useDomainState(Layouts, selectState);
	const panes = useDomain(Panes);
	const kinds = usePaneKinds();
	const fieldId = useId();
	const action = useLayoutAction();
	const track = useWorkbenchTelemetry();
	const [snapshot, setSnapshot] = useState<CapturedTemplate | null>(null);
	const [name, setName] = useState("");
	const [makeDefault, setMakeDefault] = useState(false);
	const [managing, setManaging] = useState(false);
	const [renaming, setRenaming] = useState<LayoutPreset | null>(null);
	const [updating, setUpdating] = useState<LayoutPreset | null>(null);
	const [deleting, setDeleting] = useState<LayoutPreset | null>(null);
	const { pending, error } = action;

	useEffect(() => {
		if (!error || snapshot || managing || deleting) return;
		toast.error("Layout action failed", { description: error });
	}, [deleting, error, managing, snapshot]);

	if (!layouts || !state) return null;
	const methods = layouts.methods;
	const { presets, defaultPresetId } = state;

	const errorAlert = error ? (
		<Alert variant="destructive">
			<AlertTitle>Layout action failed</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	) : null;

	function openSave(preset?: LayoutPreset) {
		action.setError(null);
		try {
			if (!panes) throw new Error("This session's panes are unavailable.");
			const current = captureLayoutTemplate(sessionPanesOf(panes, session.id), kinds);
			if (current.template.slots.length === 0) {
				action.setError("No reusable panes to save. Open a pane with + first.");
				return;
			}
			setSnapshot(current);
			setUpdating(preset ?? null);
			setName(preset?.name ?? "");
			setMakeDefault(false);
		} catch (reason) {
			action.setError(messageOf(reason, "Could not capture the current layout."));
		}
	}

	function apply(preset: LayoutPreset) {
		if (!panes) return;
		action.run(
			() => applyLayoutTemplate(panes, session.id, preset.template, kinds),
			() => track("Layout Preset Applied"),
		);
	}

	function closeSave() {
		setSnapshot(null);
		setRenaming(null);
		action.setError(null);
	}

	function closeManage() {
		setManaging(false);
		setRenaming(null);
		action.setError(null);
	}

	function cancelRename() {
		setRenaming(null);
		action.setError(null);
	}

	return (
		<>
			<DropdownMenu>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger
							render={
								<DropdownMenuTrigger
									data-qa-id="chat-layouts-menu"
									aria-label="Layouts"
									render={<Button variant="ghost" size="icon-sm" disabled={pending} />}
								/>
							}
						>
							<PanelsTopLeftIcon className="size-3.5" aria-hidden />
						</TooltipTrigger>
						<TooltipContent side="bottom">Layouts</TooltipContent>
					</Tooltip>
				</TooltipProvider>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuGroup>
						{presets.length === 0 ? (
							<DropdownMenuItem disabled>No layouts yet</DropdownMenuItem>
						) : null}
						{presets.map((preset) => (
							<DropdownMenuItem
								key={preset.id}
								data-qa-id={`chat-layout-apply-${preset.id}`}
								aria-label={`Apply ${preset.name}`}
								aria-description={
									defaultPresetId === preset.id ? "Default layout for new sessions" : undefined
								}
								disabled={pending}
								onClick={() => apply(preset)}
							>
								<span className="min-w-0 flex-1 truncate">{preset.name}</span>
								{defaultPresetId === preset.id ? <Badge variant="secondary">Default</Badge> : null}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							data-qa-id="chat-layout-save-current"
							disabled={pending}
							onClick={() => openSave()}
						>
							Save current layout
						</DropdownMenuItem>
						<DropdownMenuItem
							data-qa-id="chat-layout-manage"
							disabled={pending}
							onClick={() => {
								action.setError(null);
								setManaging(true);
							}}
						>
							Manage layouts
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog
				open={managing && !snapshot && !deleting}
				onOpenChange={(open) => {
					if (!open && !pending) closeManage();
				}}
			>
				<DialogContent
					className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
					showCloseButton={!pending}
				>
					<DialogHeader>
						<DialogTitle>Manage layouts</DialogTitle>
						<DialogDescription>
							The default layout is used for new sessions. Existing sessions are unchanged.
						</DialogDescription>
					</DialogHeader>
					<div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
						{presets.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>No layouts yet</EmptyTitle>
								</EmptyHeader>
							</Empty>
						) : null}
						<TooltipProvider>
							<ItemGroup>
								{presets.map((preset) => {
									const isDefault = defaultPresetId === preset.id;
									const defaultLabel = isDefault
										? "Clear default layout"
										: `Set ${preset.name} as default`;
									return (
										<Item
											key={preset.id}
											role="listitem"
											variant="outline"
											size="sm"
											className="sm:flex-nowrap"
										>
											<ItemMedia variant="icon" className="text-muted-foreground">
												<Tooltip>
													<TooltipTrigger
														render={
															<Button
																type="button"
																variant="ghost"
																size="icon-sm"
																aria-label={defaultLabel}
																aria-pressed={isDefault}
																data-qa-id={`chat-layout-set-default-${preset.id}`}
																disabled={pending}
																onClick={() =>
																	action.run(
																		() => methods.setDefault({ id: isDefault ? null : preset.id }),
																		() =>
																			track("Layout Preset Default Changed", {
																				cleared: isDefault,
																			}),
																	)
																}
															/>
														}
													>
														<StarIcon
															aria-hidden
															className={cn(isDefault && "fill-current text-yellow-500")}
														/>
													</TooltipTrigger>
													<TooltipContent>{defaultLabel}</TooltipContent>
												</Tooltip>
											</ItemMedia>
											<ItemContent className="min-w-0">
												{renaming?.id === preset.id ? (
													<form
														onSubmit={(event) => {
															event.preventDefault();
															if (pending || !name.trim()) return;
															action.run(
																() => methods.rename({ id: preset.id, name: name.trim() }),
																() => setRenaming(null),
															);
														}}
													>
														<Field orientation="horizontal">
															<Input
																aria-label="Layout name"
																data-qa-id="chat-layout-name"
																className="h-7"
																value={name}
																onChange={(event) => setName(event.target.value)}
																maxLength={100}
																disabled={pending}
																autoFocus
																onFocus={(event) => event.target.select()}
																onKeyDown={(event) => {
																	if (event.key !== "Escape") return;
																	event.preventDefault();
																	event.stopPropagation();
																	if (!pending) cancelRename();
																}}
															/>
															<Button
																type="submit"
																variant="ghost"
																size="icon-sm"
																aria-label="Save name"
																data-qa-id="chat-layout-rename-save"
																disabled={pending || !name.trim()}
															>
																<CheckIcon />
															</Button>
															<LayoutAction
																label="Cancel rename"
																qaId="chat-layout-rename-cancel"
																disabled={pending}
																onClick={cancelRename}
															>
																<XIcon />
															</LayoutAction>
														</Field>
													</form>
												) : (
													<ItemTitle className="max-w-full">
														<span className="truncate">{preset.name}</span>
													</ItemTitle>
												)}
											</ItemContent>
											{renaming?.id !== preset.id ? (
												<ItemActions className="ml-auto gap-1">
													<LayoutAction
														disabled={pending || renaming !== null}
														label={`Update ${preset.name} from current layout`}
														qaId={`chat-layout-update-${preset.id}`}
														onClick={() => openSave(preset)}
													>
														<SaveIcon />
													</LayoutAction>
													<LayoutAction
														disabled={pending || renaming !== null}
														label={`Rename ${preset.name}`}
														qaId={`chat-layout-rename-${preset.id}`}
														onClick={() => {
															action.setError(null);
															setRenaming(preset);
															setName(preset.name);
														}}
													>
														<PencilIcon />
													</LayoutAction>
													<LayoutAction
														destructive
														disabled={pending || renaming !== null}
														label={`Delete ${preset.name}`}
														qaId={`chat-layout-delete-${preset.id}`}
														onClick={() => {
															action.setError(null);
															setDeleting(preset);
														}}
													>
														<Trash2Icon />
													</LayoutAction>
												</ItemActions>
											) : null}
										</Item>
									);
								})}
							</ItemGroup>
						</TooltipProvider>
					</div>
					{errorAlert}
					{pending ? <p role="status">Updating layouts...</p> : null}
					<DialogFooter>
						<Button
							data-qa-id="chat-layout-manage-close"
							variant="outline"
							disabled={pending}
							onClick={closeManage}
						>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open && !pending) {
						setDeleting(null);
						action.setError(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the saved layout, not its sessions or resources. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{errorAlert}
					<AlertDialogFooter>
						<AlertDialogCancel data-qa-id="chat-layout-delete-cancel" disabled={pending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							data-qa-id="chat-layout-delete-confirm"
							disabled={pending}
							onClick={() => {
								if (deleting) {
									action.run(
										() => methods.remove({ id: deleting.id }),
										() => {
											setDeleting(null);
											track("Layout Preset Removed");
										},
									);
								}
							}}
						>
							{pending ? "Deleting..." : "Delete layout"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<Dialog
				open={snapshot !== null}
				onOpenChange={(open) => {
					if (!open && !pending) closeSave();
				}}
			>
				<DialogContent
					showCloseButton={!pending}
					className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
				>
					<form
						className="contents"
						onSubmit={(event) => {
							event.preventDefault();
							if (!name.trim() || pending || !snapshot) return;
							const saved = {
								isUpdate: updating !== null,
								makeDefault: !updating && makeDefault,
								paneCount: snapshot.template.slots.length,
							};
							action.run(
								() =>
									methods.save({
										...(updating ? { id: updating.id } : { makeDefault }),
										name: name.trim(),
										template: snapshot.template,
									}),
								() => {
									setSnapshot(null);
									track("Layout Preset Saved", saved);
								},
							);
						}}
					>
						<DialogHeader>
							<DialogTitle>
								{updating ? `Update ${updating.name}` : "Save current layout"}
							</DialogTitle>
							<DialogDescription>
								{updating
									? "Replace the saved layout with the current pane positions. The default setting is unchanged."
									: "Save pane positions for reuse. Chat content and open resources are not saved."}
							</DialogDescription>
						</DialogHeader>
						{!updating ? (
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={`${fieldId}-name`}>Layout name</FieldLabel>
									<Input
										id={`${fieldId}-name`}
										data-qa-id="chat-layout-name"
										value={name}
										onChange={(event) => setName(event.target.value)}
										maxLength={100}
										disabled={pending}
										autoFocus
									/>
								</Field>
								<Field orientation="horizontal">
									<Checkbox
										id={`${fieldId}-default`}
										data-qa-id="chat-layout-default"
										checked={makeDefault}
										onCheckedChange={setMakeDefault}
										disabled={pending}
									/>
									<FieldLabel htmlFor={`${fieldId}-default`}>
										Use as default for new sessions
									</FieldLabel>
								</Field>
							</FieldGroup>
						) : null}
						{snapshot?.omittedTitles.length ? (
							<Alert>
								<AlertTitle>Some panes will not be saved</AlertTitle>
								<AlertDescription>
									{snapshot.omittedTitles.join(", ")} cannot be recreated in a new session and will
									be omitted.
								</AlertDescription>
							</Alert>
						) : null}
						{errorAlert}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								data-qa-id="chat-layout-save-cancel"
								disabled={pending}
								onClick={closeSave}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								data-qa-id="chat-layout-save"
								disabled={pending || !name.trim()}
							>
								{pending ? "Saving..." : updating ? "Update layout" : "Save layout"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
