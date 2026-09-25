import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CheckIcon,
	PanelsTopLeftIcon,
	PencilIcon,
	SaveIcon,
	StarIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useSdk } from "@kilo-desktop/sdk-react";
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
import { cn } from "@kilo-desktop/ui/lib/utils";
import { toast } from "@kilo-desktop/ui/components/sonner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
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
import { Empty, EmptyHeader, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import type {
	LayoutPreset,
	LayoutPresetsService,
	LayoutPresetsState,
	LayoutTemplate,
} from "../../../contracts/layout-presets/schemas.js";
import { layoutPresetsQueryKey, useLayoutPresets } from "./use-layout-presets.js";

export type LayoutPresetsMenuProps = {
	capture: () => { template: LayoutTemplate; omittedTitles: string[] };
	onApply: (preset: LayoutPreset) => void;
};

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

export function LayoutPresetsMenu({ capture, onApply }: LayoutPresetsMenuProps) {
	const sdk = useSdk<LayoutPresetsService>("kilo-ui");
	const query = useLayoutPresets();
	const queryClient = useQueryClient();
	const fieldId = useId();
	const [snapshot, setSnapshot] = useState<ReturnType<typeof capture> | null>(null);
	const [name, setName] = useState("");
	const [makeDefault, setMakeDefault] = useState(false);
	const [managing, setManaging] = useState(false);
	const [renaming, setRenaming] = useState<LayoutPreset | null>(null);
	const [updating, setUpdating] = useState<LayoutPreset | null>(null);
	const [deleting, setDeleting] = useState<LayoutPreset | null>(null);
	const [captureError, setCaptureError] = useState<string | null>(null);
	const mutation = useMutation({
		mutationFn: (operation: () => Promise<LayoutPresetsState>) => operation(),
		onSuccess: (state) => queryClient.setQueryData(layoutPresetsQueryKey, state),
	});
	const apply = useMutation({
		mutationFn: async (preset: LayoutPreset) => {
			await onApply(preset);
		},
	});
	const pending = mutation.isPending || apply.isPending;
	const error =
		mutation.error?.message ?? apply.error?.message ?? captureError ?? query.error?.message;
	const errorAlert = error ? (
		<Alert variant="destructive">
			<AlertTitle>Layout action failed</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	) : null;
	useEffect(() => {
		if (!error || snapshot || managing || deleting) return;
		toast.error("Layout action failed", { description: error });
	}, [deleting, error, managing, snapshot]);

	function openSave(preset?: LayoutPreset) {
		mutation.reset();
		apply.reset();
		setCaptureError(null);
		try {
			const current = capture();
			if (current.template.slots.length === 0) {
				setCaptureError("No reusable panes to save. Open Chat, Changes, Terminal, or Files first.");
				return;
			}
			setSnapshot(current);
			setUpdating(preset ?? null);
			setName(preset?.name ?? "");
			setMakeDefault(false);
		} catch (reason) {
			setCaptureError(
				reason instanceof Error ? reason.message : "Could not capture the current layout.",
			);
		}
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
									render={<Button variant="outline" size="icon-sm" disabled={pending} />}
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
						{query.isPending ? (
							<DropdownMenuItem disabled>Loading layouts...</DropdownMenuItem>
						) : null}
						{query.isError ? (
							<DropdownMenuItem
								data-qa-id="chat-layout-retry"
								disabled={query.isFetching}
								onClick={() => {
									void query.refetch();
								}}
							>
								Retry loading layouts
							</DropdownMenuItem>
						) : null}
						{query.data?.presets.length === 0 ? (
							<DropdownMenuItem disabled>No layouts yet</DropdownMenuItem>
						) : null}
						{query.data?.presets.map((preset) => (
							<DropdownMenuItem
								key={preset.id}
								data-qa-id={`chat-layout-apply-${preset.id}`}
								aria-label={`Apply ${preset.name}`}
								aria-description={
									query.data.defaultPresetId === preset.id
										? "Default layout for new chats"
										: undefined
								}
								disabled={pending}
								onClick={() => {
									mutation.reset();
									setCaptureError(null);
									apply.mutate(preset);
								}}
							>
								<span className="min-w-0 flex-1 truncate">{preset.name}</span>
								{query.data.defaultPresetId === preset.id ? (
									<Badge variant="secondary">Default</Badge>
								) : null}
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
								mutation.reset();
								apply.reset();
								setCaptureError(null);
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
					if (!open && !pending) {
						setManaging(false);
						setRenaming(null);
					}
				}}
			>
				<DialogContent
					className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
					showCloseButton={!pending}
				>
					<DialogHeader>
						<DialogTitle>Manage layouts</DialogTitle>
						<DialogDescription>
							The default layout is used for new chats. Existing chats are unchanged.
						</DialogDescription>
					</DialogHeader>
					<div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
						{query.isPending ? <p role="status">Loading layouts...</p> : null}
						{query.data?.presets.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>No layouts yet</EmptyTitle>
								</EmptyHeader>
							</Empty>
						) : null}
						<TooltipProvider>
							<ItemGroup>
								{query.data?.presets.map((preset) => (
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
															aria-label={
																query.data.defaultPresetId === preset.id
																	? "Clear default layout"
																	: `Set ${preset.name} as default`
															}
															aria-pressed={query.data.defaultPresetId === preset.id}
															data-qa-id={`chat-layout-set-default-${preset.id}`}
															disabled={pending}
															onClick={() => {
																setCaptureError(null);
																mutation.mutate(() =>
																	sdk.client["layoutPresets.setDefault"]({
																		id: query.data.defaultPresetId === preset.id ? null : preset.id,
																	}),
																);
															}}
														/>
													}
												>
													<StarIcon
														aria-hidden
														className={cn(
															query.data.defaultPresetId === preset.id &&
																"fill-current text-yellow-500",
														)}
													/>
												</TooltipTrigger>
												<TooltipContent>
													{query.data.defaultPresetId === preset.id
														? "Clear default layout"
														: `Set ${preset.name} as default`}
												</TooltipContent>
											</Tooltip>
										</ItemMedia>
										<ItemContent className="min-w-0">
											{renaming?.id === preset.id ? (
												<form
													onSubmit={(event) => {
														event.preventDefault();
														if (pending || !name.trim()) return;
														mutation.mutate(
															() =>
																sdk.client["layoutPresets.rename"]({
																	id: preset.id,
																	name: name.trim(),
																}),
															{ onSuccess: () => setRenaming(null) },
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
																if (!pending) {
																	setRenaming(null);
																	mutation.reset();
																}
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
															onClick={() => {
																setRenaming(null);
																mutation.reset();
															}}
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
														mutation.reset();
														setCaptureError(null);
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
														mutation.reset();
														setDeleting(preset);
														setCaptureError(null);
													}}
												>
													<Trash2Icon />
												</LayoutAction>
											</ItemActions>
										) : null}
									</Item>
								))}
							</ItemGroup>
						</TooltipProvider>
					</div>
					{errorAlert}
					{query.isError ? (
						<Button
							variant="outline"
							data-qa-id="chat-layout-manage-retry"
							disabled={query.isFetching}
							onClick={() => {
								void query.refetch();
							}}
						>
							Retry loading layouts
						</Button>
					) : null}
					{pending ? <p role="status">Updating layouts...</p> : null}
					<DialogFooter>
						<Button
							data-qa-id="chat-layout-manage-close"
							variant="outline"
							disabled={pending}
							onClick={() => {
								setManaging(false);
								setRenaming(null);
							}}
						>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open && !pending) setDeleting(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the saved layout, not its chats or resources. This cannot be undone.
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
								if (deleting)
									mutation.mutate(() => sdk.client["layoutPresets.remove"]({ id: deleting.id }), {
										onSuccess: () => setDeleting(null),
									});
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
					if (!open && !pending) {
						setSnapshot(null);
						setRenaming(null);
					}
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
							if (!name.trim() || pending) return;
							if (!snapshot) return;
							mutation.mutate(
								() =>
									sdk.client["layoutPresets.save"]({
										...(updating ? { id: updating.id } : {}),
										name: name.trim(),
										template: snapshot.template,
										...(!updating ? { makeDefault } : {}),
									}),
								{ onSuccess: () => setSnapshot(null) },
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
						<FieldGroup>
							{!updating ? (
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
							) : null}
							{!updating ? (
								<Field orientation="horizontal">
									<Checkbox
										id={`${fieldId}-default`}
										data-qa-id="chat-layout-default"
										checked={makeDefault}
										onCheckedChange={setMakeDefault}
										disabled={pending}
									/>
									<FieldLabel htmlFor={`${fieldId}-default`}>
										Use as default for new chats
									</FieldLabel>
								</Field>
							) : null}
						</FieldGroup>
						{snapshot?.omittedTitles.length ? (
							<Alert>
								<AlertTitle>Some panes will not be saved</AlertTitle>
								<AlertDescription>
									{snapshot.omittedTitles.join(", ")} cannot be recreated in a new chat and will be
									omitted.
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
								onClick={() => {
									setSnapshot(null);
									setRenaming(null);
								}}
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
