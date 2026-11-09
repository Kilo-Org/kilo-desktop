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
import { toast } from "@kilo-desktop/ui/components/sonner";

import type { CondaEnv } from "../../../contracts/providers/conda.js";
import { useConda, useCondaMutation } from "../../conda.js";
import { useTrack } from "../../app.js";
import { environmentDisplayName } from "./environment-display.js";
import { deleteEnvironmentJob, jobToastOptions } from "./environments-toasts.js";

interface DeleteEnvironmentDialogProps {
	env: CondaEnv;
	open: boolean;
	onClose: () => void;
}

/**
 * Destructive confirm for deleting an environment. Deletion can take a while,
 * so the dialog closes on confirm and a job toast reports the outcome.
 */
export function DeleteEnvironmentDialog({ env, open, onClose }: DeleteEnvironmentDialogProps) {
	const conda = useConda();
	const track = useTrack();
	const displayName = environmentDisplayName(env);

	const mutation = useCondaMutation(conda, "deleteEnvironment", {
		invalidates: ["listEnvironments"],
	});

	function handleDelete() {
		const promise = mutation.mutateAsync({
			name: env.name || undefined,
			prefix: env.prefix || undefined,
		});
		toast.promise(promise, jobToastOptions(deleteEnvironmentJob(displayName)));
		promise.then(
			() => {
				track("Environment Removed");
			},
			() => undefined,
		);
		onClose();
	}

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
		>
			<AlertDialogContent data-qa-id="environments-delete-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {displayName}?</AlertDialogTitle>
					<AlertDialogDescription>
						This permanently removes the environment and all its installed packages. This action
						cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={handleDelete}
						data-qa-id="environments-delete-submit"
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
