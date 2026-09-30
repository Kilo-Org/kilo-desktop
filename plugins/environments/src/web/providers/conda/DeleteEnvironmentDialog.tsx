import { useSdk, useSdkMutation } from "@kilo-desktop/sdk-react";
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

import type { CondaEnv, CondaService } from "../../../contracts/providers/conda.js";
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
	const sdk = useSdk<CondaService>("environments");
	const displayName = environmentDisplayName(env);

	const mutation = useSdkMutation(sdk, "conda.envs.delete", {
		invalidates: ["conda.envs.list"],
	});

	function handleDelete() {
		const promise = mutation.mutateAsync({
			name: env.name || undefined,
			prefix: env.prefix || undefined,
		});
		toast.promise(promise, jobToastOptions(deleteEnvironmentJob(displayName)));
		promise.then(
			() => {
				void sdk.telemetry.track({ event: "Environment Removed", data: {} }).catch(() => undefined);
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
