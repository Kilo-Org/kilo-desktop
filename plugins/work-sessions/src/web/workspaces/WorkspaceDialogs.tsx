import { FolderIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import type { DialogProps } from "@kilo-desktop/plugin-shell/contracts";
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

import {
	Workspaces,
	type Workspace,
	type WorkspaceDialogInput,
	type WorkspacesState,
} from "../../contracts";
import { WorkspaceFormFields } from "./WorkspaceFormFields";
import { useFolderPicking, useWorkspaceForm } from "./useWorkspaceForm";
import { workspaceGlyphStyle } from "./workspace-glyph-style";

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
	workspaces: Workspace[];
	unavailableFolderIds: readonly string[];
};

const selectState = (state: WorkspacesState) => state;
const errorText = (reason: unknown, fallback: string) =>
	reason instanceof Error && reason.message ? reason.message : fallback;

/** Manage, create / edit and delete workspaces; which one is open is `dialog`. */
function WorkspaceDialogs({
	dialog,
	onClose,
	onDialogChange,
}: Pick<WorkspaceDialogsProps, "dialog" | "onClose" | "onDialogChange">) {
	const state = useDomainObjectState(Workspaces, selectState);
	const props: WorkspaceDialogsProps = {
		dialog,
		onClose,
		onDialogChange,
		workspaces: state?.workspaces ?? [],
		unavailableFolderIds: state?.unavailableFolderIds ?? [],
	};
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
	unavailableFolderIds,
	workspace,
}: WorkspaceDialogsProps & { workspace?: Workspace }) {
	const workspaces = useDomainObject(Workspaces);
	const form = useWorkspaceForm({ workspace, shell: useFolderPicking() });
	const [pending, setPending] = useState(false);
	const unavailable = new Set(unavailableFolderIds);
	const unavailablePaths = new Set(
		workspace?.folders.filter((folder) => unavailable.has(folder.id)).map((folder) => folder.path),
	);

	const save = async () => {
		if (!workspaces) return;
		setPending(true);
		try {
			const fields = { name: form.name, color: form.color, folders: form.folders };
			if (workspace) {
				await workspaces.methods.update({ id: workspace.id, ...fields });
			} else {
				const saved = await workspaces.methods.create({ ...fields, source: "dialog" });
				await workspaces.methods.setActive({ id: saved.id });
			}
			onClose();
		} catch (reason) {
			form.setError(errorText(reason, "Could not save workspace."));
		} finally {
			setPending(false);
		}
	};
	const mutation = { isPending: pending, mutate: () => void save() };

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
					<WorkspaceFormFields {...form} unavailablePaths={unavailablePaths} />
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
	workspace,
}: WorkspaceDialogsProps & { workspace: Workspace }) {
	const workspaces = useDomainObject(Workspaces);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const remove = async () => {
		if (!workspaces) return;
		setPending(true);
		setError(null);
		try {
			// Removing the active workspace leaves none active (decided in main).
			await workspaces.methods.remove({ id: workspace.id });
			onClose();
		} catch (reason) {
			setError(errorText(reason, "Could not delete workspace."));
		} finally {
			setPending(false);
		}
	};
	const mutation = { isPending: pending, mutate: () => void remove() };
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

const WORKSPACE_DIALOG_MODES = new Set(["create", "manage", "edit", "delete"]);

function isWorkspaceDialogInput(input: unknown): input is WorkspaceDialogInput {
	if (typeof input !== "object" || input === null) return false;
	const { mode, workspaceId } = input as { mode?: unknown; workspaceId?: unknown };
	if (typeof mode !== "string" || !WORKSPACE_DIALOG_MODES.has(mode)) return false;
	return mode === "create" || mode === "manage" || typeof workspaceId === "string";
}

/** The workspace dialog `input` names, with its workspace; null when that workspace is gone. */
function resolveDialog(
	input: WorkspaceDialogInput,
	workspaces: readonly Workspace[],
): Exclude<WorkspaceDialogState, null> | null {
	if (input.mode === "create" || input.mode === "manage") return input;
	const workspace = workspaces.find((candidate) => candidate.id === input.workspaceId);
	return workspace ? { mode: input.mode, workspace } : null;
}

/**
 * The `kilo.shell/dialog` `workspace-dialogs` contribution, mounted while it
 * is open: starts on the dialog its command asked for (`input`) and moves
 * between them (Manage → Edit) itself. Asking for it again while it is open
 * switches to the newly asked one. A workspace that no longer exists (or no workspaces at all) closes it.
 */
export function WorkspaceDialogsDialog({ close, input }: DialogProps) {
	const asked = isWorkspaceDialogInput(input) ? input : null;
	const [shownInput, setShownInput] = useState(input);
	const [current, setCurrent] = useState<WorkspaceDialogInput | null>(asked);
	if (shownInput !== input) {
		setShownInput(input);
		setCurrent(asked);
	}
	const workspaces = useDomainObjectState(Workspaces, selectState)?.workspaces ?? [];
	const dialog = current ? resolveDialog(current, workspaces) : null;
	const gone = dialog === null;
	useEffect(() => {
		if (gone) close();
	}, [close, gone]);

	return (
		<WorkspaceDialogs
			dialog={dialog}
			onClose={close}
			onDialogChange={(next) =>
				setCurrent(
					next.mode === "edit" || next.mode === "delete"
						? { mode: next.mode, workspaceId: next.workspace.id }
						: next,
				)
			}
		/>
	);
}
