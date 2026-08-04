import { useMutation, type QueryClient } from "@tanstack/react-query";
import { FolderIcon, FolderPlusIcon, XIcon } from "lucide-react";
import { useEffect, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@anaconda-agentic-desktop/ui/components/alert-dialog";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import type {
	Workspace,
	WorkspaceFolderInput,
	WorkspacesService,
} from "@anaconda-agentic-desktop/contracts";
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import { workspacesQueryKey } from "./WorkspacesFeatureProvider";

export type WorkspaceDialogState =
	| null
	| { mode: "create" }
	| { mode: "edit"; workspace: Workspace }
	| { mode: "delete"; workspace: Workspace };

type WorkspaceDialogsProps = {
	dialog: WorkspaceDialogState;
	onClose(): void;
	sdk: SDK<WorkspacesService>;
	queryClient: QueryClient;
	workspaces: Workspace[];
	activeWorkspaceId: string | null;
	setActiveWorkspaceId(id: string | null): void;
};

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function WorkspaceDialogs(props: WorkspaceDialogsProps) {
	if (props.dialog?.mode === "delete")
		return <DeleteWorkspaceDialog {...props} workspace={props.dialog.workspace} />;
	if (props.dialog?.mode === "create" || props.dialog?.mode === "edit") {
		return props.dialog.mode === "edit" ? (
			<WorkspaceFormDialog {...props} workspace={props.dialog.workspace} />
		) : (
			<WorkspaceFormDialog {...props} />
		);
	}
	return null;
}

function WorkspaceFormDialog({
	dialog,
	onClose,
	sdk,
	queryClient,
	setActiveWorkspaceId,
	workspace,
}: WorkspaceDialogsProps & { workspace?: Workspace }) {
	const [name, setName] = useState(workspace?.name ?? "");
	const [folders, setFolders] = useState<WorkspaceFolderInput[]>(
		workspace?.folders.map(({ path, isPrimary }) => ({ path, isPrimary })) ?? [],
	);
	const [error, setError] = useState<string | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		setName(workspace?.name ?? "");
		setFolders(workspace?.folders.map(({ path, isPrimary }) => ({ path, isPrimary })) ?? []);
		setError(null);
		setIsDragging(false);
	}, [workspace]);

	const mutation = useMutation({
		mutationFn: () =>
			workspace
				? sdk.client.update({ id: workspace.id, name, folders })
				: sdk.client.create({ name, folders }),
		onSuccess: async (saved) => {
			if (!workspace) setActiveWorkspaceId(saved.id);
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
			onClose();
		},
		onError: (reason) =>
			setError(reason instanceof Error ? reason.message : "Could not save workspace."),
	});

	const addPaths = (paths: string[]) => {
		setFolders((current) => {
			const known = new Set(current.map((folder) => folder.path));
			const additions = paths.filter((folderPath) => folderPath && !known.has(folderPath));
			return [
				...current,
				...additions.map((path, index) => ({
					path,
					isPrimary: current.length === 0 && index === 0,
				})),
			];
		});
	};

	const chooseFolders = async () => {
		setError(null);
		try {
			const result = await sdk.shell.showOpenDialog({ kind: "directory", multiple: true });
			if (!result.canceled) addPaths(result.paths);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Could not open the folder picker.");
		}
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		const paths: string[] = [];
		for (const item of event.dataTransfer.items) {
			const entry = item.webkitGetAsEntry();
			if (!entry?.isDirectory) {
				setError("Only folders can be added to a workspace.");
				continue;
			}
			const file = item.getAsFile();
			if (file) {
				const path = sdk.shell.getPathForFile(file);
				if (path) paths.push(path);
			}
		}
		if (paths.length === 0 && !error) setError("Dropped folders could not be resolved.");
		addPaths(paths);
	};

	const removeFolder = (path: string) => {
		setFolders((current) => {
			const remaining = current.filter((folder) => folder.path !== path);
			if (remaining.length > 0 && !remaining.some((folder) => folder.isPrimary)) {
				return remaining.map((folder, index) => ({ ...folder, isPrimary: index === 0 }));
			}
			return remaining;
		});
	};

	const makePrimary = (path: string) => {
		setFolders((current) => {
			const selected = current.find((folder) => folder.path === path);
			if (!selected) return current;
			return [selected, ...current.filter((folder) => folder.path !== path)].map(
				(folder, index) => ({ ...folder, isPrimary: index === 0 }),
			);
		});
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		if (folders.length === 0) {
			setError("Add at least one project folder.");
			return;
		}
		mutation.mutate();
	};

	return (
		<Dialog open={dialog !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-qa-id="workspace-form-dialog" className="sm:max-w-lg">
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>{workspace ? "Edit workspace" : "Create workspace"}</DialogTitle>
					</DialogHeader>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
							<Input
								id="workspace-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="e.g. My project"
							/>
						</Field>
						<Field>
							<FieldLabel>Folders</FieldLabel>
							<div
								onDragOver={(event) => {
									event.preventDefault();
									setIsDragging(true);
								}}
								onDragLeave={(event) => {
									if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
										setIsDragging(false);
									}
								}}
								onDrop={(event) => {
									setIsDragging(false);
									onDrop(event);
								}}
								className={cn(
									"rounded-xl border transition-colors",
									folders.length === 0 && "border-dashed",
									isDragging ? "border-primary border-dashed bg-primary/5" : "border-border",
								)}
							>
								{folders.length === 0 ? (
									<div
										role="button"
										tabIndex={0}
										onClick={() => void chooseFolders()}
										onKeyDown={(event: KeyboardEvent) => {
											if (event.key === "Enter" || event.key === " ") void chooseFolders();
										}}
										className="hover:bg-foreground/5 flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[11px] text-center transition-colors"
									>
										<div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
											<FolderPlusIcon className="size-4" />
										</div>
										<div className="flex flex-col gap-0.5">
											<span className="text-sm font-medium">Drop project folders here</span>
											<span className="text-muted-foreground text-xs">
												or click to choose folders
											</span>
										</div>
									</div>
								) : (
									<div className="flex flex-col">
										<TooltipProvider>
											<ItemGroup className="gap-0.5 p-1 has-data-[size=sm]:gap-0.5">
												{folders.map((folder) => (
													<Item
														key={folder.path}
														size="sm"
														role="listitem"
														className="flex-nowrap gap-2 px-2 py-1"
													>
														<ItemMedia variant="icon" className="text-muted-foreground">
															<FolderIcon />
														</ItemMedia>
														<ItemContent className="min-w-0">
															<Tooltip>
																<TooltipTrigger
																	render={<ItemTitle className="max-w-full cursor-default" />}
																>
																	{folderName(folder.path)}
																</TooltipTrigger>
																<TooltipContent className="max-w-sm font-mono break-all">
																	{folder.path}
																</TooltipContent>
															</Tooltip>
														</ItemContent>
														<ItemActions className="gap-1">
															{folder.isPrimary ? (
																<span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
																	Primary
																</span>
															) : (
																<Button
																	type="button"
																	variant="ghost"
																	size="xs"
																	className="opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100"
																	onClick={() => makePrimary(folder.path)}
																>
																	Make primary
																</Button>
															)}
															<Button
																type="button"
																variant="ghost"
																size="icon-xs"
																aria-label={`Remove ${folder.path}`}
																className="text-muted-foreground -mr-1.5"
																onClick={() => removeFolder(folder.path)}
															>
																<XIcon />
															</Button>
														</ItemActions>
													</Item>
												))}
											</ItemGroup>
										</TooltipProvider>
										<div className="border-border border-t p-1">
											<button
												type="button"
												onClick={() => void chooseFolders()}
												className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground flex w-full items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors"
											>
												<FolderPlusIcon className="size-4" />
												Add folder
											</button>
										</div>
									</div>
								)}
							</div>
						</Field>
						{error ? <FieldError>{error}</FieldError> : null}
					</FieldGroup>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={mutation.isPending || folders.length === 0}>
							{mutation.isPending ? "Saving…" : workspace ? "Save" : "Create workspace"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function DeleteWorkspaceDialog({
	dialog,
	onClose,
	sdk,
	queryClient,
	workspaces,
	activeWorkspaceId,
	setActiveWorkspaceId,
	workspace,
}: WorkspaceDialogsProps & { workspace: Workspace }) {
	const mutation = useMutation({
		mutationFn: () => sdk.client.remove({ id: workspace.id }),
		onSuccess: async () => {
			if (activeWorkspaceId === workspace.id) {
				setActiveWorkspaceId(
					workspaces.find((candidate) => candidate.id !== workspace.id)?.id ?? null,
				);
			}
			await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
			onClose();
		},
	});
	return (
		<AlertDialog open={dialog !== null} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						This removes the workspace from the app. Project folders and their files will not be
						deleted.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={mutation.isPending}
						onClick={() => mutation.mutate()}
					>
						Delete workspace
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
