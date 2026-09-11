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
import { useSdk, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";

import type { CondaEnv, CondaPackage, CondaService } from "../../../contracts/providers/conda.js";
import { environmentDisplayName } from "./environment-display.js";
import { friendlyEnvironmentsError } from "./environments-error-message.js";

interface RemovePackageConfirmationProps {
	env: CondaEnv;
	pkg: CondaPackage;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * Confirmation dialog for removing a single package from a conda environment.
 */
export function RemovePackageConfirmation({
	env,
	pkg,
	open,
	onOpenChange,
}: RemovePackageConfirmationProps) {
	const sdk = useSdk<CondaService>("environments");
	const remove = useSdkMutation(sdk, "conda.packages.remove", {
		invalidates: ["conda.packages.list", "conda.repodata.find"],
	});

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);

	function handleConfirm() {
		remove.mutate(
			{ name: targetName, prefix: env.prefix, packages: [pkg.name] },
			{
				onSuccess: () => {
					remove.reset();
					onOpenChange(false);
				},
			},
		);
	}

	function handleOpenChange(next: boolean) {
		if (!next && remove.isPending) return;
		if (!next) remove.reset();
		onOpenChange(next);
	}

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent data-qa-id="environments-conda-remove-pkg-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Remove {pkg.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						This will uninstall <strong>{pkg.name}</strong> ({pkg.version}) from the{" "}
						<strong>{displayName}</strong> environment. Dependent packages may also be removed.
					</AlertDialogDescription>
					{remove.isError && (
						<p
							className="text-destructive text-sm"
							role="alert"
							data-qa-id="environments-conda-remove-pkg-error"
						>
							{friendlyEnvironmentsError(remove.error, "Could not remove the package.")}
						</p>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={remove.isPending}
						onClick={handleConfirm}
						data-qa-id="environments-conda-remove-pkg-confirm-btn"
					>
						{remove.isPending ? "Removing\u2026" : "Remove"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
