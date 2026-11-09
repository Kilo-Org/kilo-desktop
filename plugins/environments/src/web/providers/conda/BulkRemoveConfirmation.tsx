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

import type { CondaEnv, CondaPackage } from "../../../contracts/providers/conda.js";
import { useConda, useCondaMutation } from "../../conda.js";
import { environmentDisplayName } from "./environment-display.js";
import { friendlyEnvironmentsError } from "./environments-error-message.js";

interface BulkRemoveConfirmationProps {
	env: CondaEnv;
	packages: CondaPackage[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

/**
 * Confirmation dialog for removing multiple packages from a conda environment.
 * Lists each package name so the user can review before confirming.
 */
export function BulkRemoveConfirmation({
	env,
	packages,
	open,
	onOpenChange,
	onSuccess,
}: BulkRemoveConfirmationProps) {
	const conda = useConda();
	const remove = useCondaMutation(conda, "removePackages", {
		invalidates: ["listPackages", "findRepodata"],
	});

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);
	const count = packages.length;

	function handleConfirm() {
		remove.mutate(
			{ name: targetName, prefix: env.prefix, packages: packages.map((p) => p.name) },
			{
				onSuccess: () => {
					remove.reset();
					onOpenChange(false);
					onSuccess();
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
			<AlertDialogContent data-qa-id="environments-conda-bulk-remove-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>
						Remove {count} {count === 1 ? "package" : "packages"}?
					</AlertDialogTitle>
					<AlertDialogDescription>
						The following will be uninstalled from <strong>{displayName}</strong>. Dependent
						packages may also be removed.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<ul className="max-h-48 overflow-auto rounded-md border p-2 text-sm">
					{packages.map((pkg) => (
						<li key={pkg.name} className="flex items-center justify-between py-1">
							<span className="font-medium">{pkg.name}</span>
							<span className="text-muted-foreground text-xs">{pkg.version}</span>
						</li>
					))}
				</ul>

				{remove.isError && (
					<p
						className="text-destructive text-sm"
						role="alert"
						data-qa-id="environments-conda-bulk-remove-error"
					>
						{friendlyEnvironmentsError(remove.error, "Could not remove the selected packages.")}
					</p>
				)}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={remove.isPending}
						onClick={handleConfirm}
						data-qa-id="environments-conda-bulk-remove-confirm-btn"
					>
						{remove.isPending
							? "Removing\u2026"
							: `Remove ${count} ${count === 1 ? "package" : "packages"}`}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
