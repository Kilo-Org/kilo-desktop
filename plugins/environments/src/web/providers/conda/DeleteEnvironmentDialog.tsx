import { useSdk, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";

import type { CondaEnv, CondaService } from "../../../contracts/providers/conda.js";
import { environmentDisplayName } from "./environment-display.js";
import { trackBackgroundDeleteToast } from "./environments-toasts.js";

interface DeleteEnvironmentDialogProps {
	env: CondaEnv;
	open: boolean;
	onClose: () => void;
}

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
		trackBackgroundDeleteToast(promise, displayName);
		onClose();
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) onClose();
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent data-qa-id="environments-delete-dialog" className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Delete {displayName}</DialogTitle>
					<DialogDescription>
						This will permanently remove the environment and all its installed packages. This action
						cannot be undone.
					</DialogDescription>
				</DialogHeader>

				<DialogFooter className="border-t-0 bg-transparent">
					<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
					<Button
						variant="destructive"
						onClick={handleDelete}
						data-qa-id="environments-delete-submit"
					>
						Delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
