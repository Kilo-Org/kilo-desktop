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

import type { RightPanelTabLifecycle } from "./chat-right-panel-capability.js";
import type { RightPanelTab } from "./right-panel-tab-registry.js";

interface RightPanelTabCloseDialogProps {
	readonly tab: RightPanelTab;
	readonly lifecycle: RightPanelTabLifecycle | undefined;
	readonly onCancel: () => void;
	readonly onClose: () => void;
}

type PendingAction = "save" | "discard" | null;

export function RightPanelTabCloseDialog({
	tab,
	lifecycle,
	onCancel,
	onClose,
}: RightPanelTabCloseDialogProps) {
	const [pending, setPending] = useState<PendingAction>(null);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		if (!lifecycle?.save || pending) return;
		setPending("save");
		setError(null);
		try {
			const result = await lifecycle.save();
			if (result.outcome === "saved") {
				onClose();
				return;
			}
			if (result.outcome === "failed") {
				setError(result.reason ?? `Could not save ${tab.title}.`);
			}
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : `Could not save ${tab.title}.`);
		} finally {
			setPending(null);
		}
	};

	const discard = async () => {
		if (pending) return;
		setPending("discard");
		setError(null);
		try {
			await lifecycle?.discard?.();
			onClose();
		} catch (discardError) {
			setError(
				discardError instanceof Error
					? discardError.message
					: `Could not discard changes to ${tab.title}.`,
			);
			setPending(null);
		}
	};

	return (
		<AlertDialog open onOpenChange={(open) => !open && !pending && onCancel()}>
			<AlertDialogContent data-qa-id="chat-pane-close-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>
						{lifecycle?.save ? "Save" : "Discard"} changes to {tab.title}?
					</AlertDialogTitle>
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
					{lifecycle?.save ? (
						<AlertDialogAction
							type="button"
							disabled={pending !== null}
							data-qa-id="chat-pane-close-save"
							onClick={() => void save()}
						>
							{pending === "save" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{pending === "save" ? "Saving…" : "Save"}
						</AlertDialogAction>
					) : null}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
