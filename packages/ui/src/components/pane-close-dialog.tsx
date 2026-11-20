import { useState } from "react";

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
import { FieldError } from "@kilo-desktop/ui/components/field";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

type PendingAction = "save" | "discard" | null;

const messageOf = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback;

async function saveFailure(
	save: () => Promise<string | null>,
	fallback: string,
): Promise<string | null> {
	try {
		return await save();
	} catch (error) {
		return messageOf(error, fallback);
	}
}

/**
 * Origin's close prompt for a pane with unsaved changes (Files, Notebook). `onSave` resolves
 * null once saved, or why it could not save.
 */
export function PaneCloseDialog({
	title,
	onSave,
	onDiscard,
	onCancel,
}: {
	readonly title: string;
	readonly onSave: () => Promise<string | null>;
	readonly onDiscard: () => Promise<void>;
	readonly onCancel: () => void;
}) {
	const [pending, setPending] = useState<PendingAction>(null);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		if (pending) return;
		setPending("save");
		setError(null);
		const failure = await saveFailure(onSave, `Could not save ${title}.`);
		if (failure) setError(failure);
		setPending(null);
	};

	const discard = async () => {
		if (pending) return;
		setPending("discard");
		setError(null);
		try {
			await onDiscard();
		} catch (discardError) {
			setError(messageOf(discardError, `Could not discard changes to ${title}.`));
			setPending(null);
		}
	};

	return (
		<AlertDialog open onOpenChange={(open) => !open && !pending && onCancel()}>
			<AlertDialogContent data-qa-id="chat-pane-close-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Save changes to {title}?</AlertDialogTitle>
					<AlertDialogDescription>
						Closing this tab will discard your unsaved changes.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error ? <FieldError data-qa-id="chat-pane-close-error">{error}</FieldError> : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending !== null} data-qa-id="chat-pane-close-cancel">
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						type="button"
						variant="destructive"
						disabled={pending !== null}
						data-qa-id="chat-pane-close-discard"
						onClick={() => void discard()}
					>
						{pending === "discard" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						{pending === "discard" ? "Discarding…" : "Discard"}
					</AlertDialogAction>
					<AlertDialogAction
						type="button"
						disabled={pending !== null}
						data-qa-id="chat-pane-close-save"
						onClick={() => void save()}
					>
						{pending === "save" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						{pending === "save" ? "Saving…" : "Save"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
