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
import type { UpdateState as DesktopUpdateState } from "../contracts";

import { getInstallConfirmation } from "./updateActions";

interface InstallUpdateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	state: Pick<DesktopUpdateState, "downloadedVersion" | "availableVersion">;
	onConfirm: () => void;
}

/** Confirms restarting to install a downloaded update. */
export function InstallUpdateDialog({
	open,
	onOpenChange,
	state,
	onConfirm,
}: InstallUpdateDialogProps) {
	const { title, description, windowsNote } = getInstallConfirmation(state, navigator.platform);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-qa-id="update-install-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
					{windowsNote ? <AlertDialogDescription>{windowsNote}</AlertDialogDescription> : null}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel data-qa-id="update-install-cancel">Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm} data-qa-id="update-install-confirm">
						Install and restart
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
