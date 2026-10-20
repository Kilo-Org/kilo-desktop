import { useMutation, type QueryClient } from "@tanstack/react-query";
import { FolderIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";

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
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { FieldError } from "@kilo-desktop/ui/components/field";
import type { Workspace, WorkspacesService } from "../../contracts/workspaces/schemas.js";
import type { SDK } from "@kilo-desktop/feature-sdk";
import { sdkQueryKey } from "@kilo-desktop/sdk-react";

import { WorkspaceFormFields } from "./WorkspaceFormFields.js";
import { useWorkspaceForm } from "./useWorkspaceForm.js";
import { workspaceGlyphStyle } from "./workspace-glyph-style.js";

export type WorkspaceDialogState =
	| null
	| { mode: "manage" }
	| { mode: "create" }
	| { mode: "edit"; workspace: Workspace }
	| { mode: "delete"; workspace: Workspace };

type WorkspaceDialogsProps = {
	dialog: WorkspaceDialogState;
	onClose(): void;
	onDialogChange(dialog: Exclude<WorkspaceDialogState, null>): void;
	sdk: SDK<WorkspacesService>;
	queryClient: QueryClient;
	workspaces: Workspace[];
	activeWorkspaceId: string | null;
	setActiveWorkspaceId(id: string | null): void;
};

export function WorkspaceDialogs(props: WorkspaceDialogsProps) {
	if (props.dialog?.mode === "manage") return <ManageWorkspacesDialog {...props} />;
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

function ManageWorkspacesDialog({
	dialog,
	onClose,
	onDialogChange,
	workspaces,
}: WorkspaceDialogsProps) {
	return (
		<Dialog open={dialog !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				data-qa-id="workspace-manager-dialog"
				className="sm:max-w-lg"
				showCloseButton={false}
			>
				<DialogHeader>
					<DialogTitle>Manage workspaces</DialogTitle>
				</DialogHeader>
				{workspaces.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FolderIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No workspaces yet</EmptyTitle>
							<EmptyDescription>
								Create a workspace to group folders for your sessions.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="border-border bg-card divide-border scroll-fade-y flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border">
						{workspaces.map((workspace) => (
							<li key={workspace.id}>
								<SummaryCard.Row>
									<SummaryCard.Icon>
										<FolderIcon style={workspaceGlyphStyle(workspace.color)} aria-hidden="true" />
									</SummaryCard.Icon>
									<SummaryCard.Content>
										<SummaryCard.Title>{workspace.name}</SummaryCard.Title>
									</SummaryCard.Content>
									<SummaryCard.Actions>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`Edit ${workspace.name}`}
											onClick={() => onDialogChange({ mode: "edit", workspace })}
										>
											<PencilIcon />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`Delete ${workspace.name}`}
											onClick={() => onDialogChange({ mode: "delete", workspace })}
										>
											<Trash2Icon />
										</Button>
									</SummaryCard.Actions>
								</SummaryCard.Row>
							</li>
						))}
					</ul>
				)}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
					<Button type="button" onClick={() => onDialogChange({ mode: "create" })}>
						<PlusIcon data-icon="inline-start" />
						Create workspace
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function WorkspaceFormDialog({
	dialog,
	onClose,
	sdk,
	queryClient,
	setActiveWorkspaceId,
	workspace,
}: WorkspaceDialogsProps & { workspace?: Workspace }) {
	const form = useWorkspaceForm({ workspace, shell: sdk.shell });

	const mutation = useMutation({
		mutationFn: () =>
			workspace
				? sdk.client.update({
						id: workspace.id,
						name: form.name,
						color: form.color,
						folders: form.folders,
					})
				: sdk.client.create({ name: form.name, color: form.color, folders: form.folders }),
		onSuccess: async (saved) => {
			const listQueryKey = sdkQueryKey(sdk, "list");
			queryClient.setQueryData<Workspace[]>(listQueryKey, (current) => {
				if (!current) return [saved];
				if (current.some((item) => item.id === saved.id)) {
					return current.map((item) => (item.id === saved.id ? saved : item));
				}
				return [...current, saved];
			});
			if (!workspace) {
				setActiveWorkspaceId(saved.id);
				void sdk.telemetry
					.track({
						event: "Workspace Created",
						data: { source: "dialog", folderCount: saved.folders.length },
					})
					.catch(() => undefined);
			}
			await queryClient.invalidateQueries({ queryKey: listQueryKey });
			onClose();
		},
		onError: (reason) =>
			form.setError(reason instanceof Error ? reason.message : "Could not save workspace."),
	});

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!form.validate()) return;
		mutation.mutate();
	};

	return (
		<Dialog open={dialog !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-qa-id="workspace-form-dialog" className="sm:max-w-lg">
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>{workspace ? "Edit workspace" : "Create workspace"}</DialogTitle>
					</DialogHeader>
					<WorkspaceFormFields {...form} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={mutation.isPending || form.folders.length === 0}>
							{mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
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
	const [error, setError] = useState<string | null>(null);
	const mutation = useMutation({
		mutationFn: () => sdk.client.remove({ id: workspace.id }),
		onMutate: () => setError(null),
		onSuccess: async () => {
			void sdk.telemetry
				.track({ event: "Workspace Removed", data: { folderCount: workspace.folders.length } })
				.catch(() => undefined);
			if (activeWorkspaceId === workspace.id) {
				setActiveWorkspaceId(
					workspaces.find((candidate) => candidate.id !== workspace.id)?.id ?? null,
				);
			}
			await queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "list") });
			onClose();
		},
		onError: (reason) =>
			setError(reason instanceof Error ? reason.message : "Could not delete workspace."),
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
					{error ? <FieldError>{error}</FieldError> : null}
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
