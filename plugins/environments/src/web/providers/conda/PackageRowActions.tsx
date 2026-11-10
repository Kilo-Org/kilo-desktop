import { useState } from "react";

import { EllipsisIcon, Trash2Icon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { CondaEnv, CondaPackage } from "../../../contracts/providers/conda";
import { UpdateIcon } from "./package-change-icons";
import { RemovePackageConfirmation } from "./RemovePackageConfirmation";

interface PackageRowActionsProps {
	env: CondaEnv;
	pkg: CondaPackage;
	/**
	 * Whether a newer version of this package is available. When false, the
	 * "Update…" action is disabled and shows a tooltip explaining why.
	 */
	hasUpdate?: boolean;
	/**
	 * Invoked when the user picks "Update…". The parent owns the update
	 * flow so the single-package path shares the same preview/backup sheet
	 * (and in-flight indicator) as the bulk and update-all paths.
	 */
	onUpdate: (pkg: CondaPackage) => void;
}

/**
 * Per-row action menu for a package in the environment detail table.
 * "Update…" delegates to the parent via `onUpdate`; "Remove" opens its
 * own confirmation dialog. The "Update" action is disabled (with an
 * explanatory tooltip) when no newer version is available so the user
 * gets immediate feedback rather than opening a dialog only to see
 * "already up to date".
 */
export function PackageRowActions({
	env,
	pkg,
	hasUpdate = true,
	onUpdate,
}: PackageRowActionsProps) {
	const [showRemove, setShowRemove] = useState(false);

	const updateItem = (
		<DropdownMenuItem disabled={!hasUpdate} onClick={hasUpdate ? () => onUpdate(pkg) : undefined}>
			<UpdateIcon />
			Update…
		</DropdownMenuItem>
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Actions for ${pkg.name}`}
							data-qa-id="environments-conda-detail-row-actions"
						/>
					}
				>
					<EllipsisIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{hasUpdate ? (
						updateItem
					) : (
						// A disabled DropdownMenuItem has `pointer-events: none`, so a
						// Tooltip wrapped directly around it never fires on hover.
						// Wrapping in a span that carries the TooltipTrigger keeps the
						// item non-interactive while still surfacing the explanation.
						<Tooltip>
							<TooltipTrigger render={<span className="block" />}>{updateItem}</TooltipTrigger>
							<TooltipContent side="left">
								This package is already at the latest available version.
							</TooltipContent>
						</Tooltip>
					)}
					<DropdownMenuItem variant="destructive" onClick={() => setShowRemove(true)}>
						<Trash2Icon />
						Remove
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{showRemove && (
				<RemovePackageConfirmation
					env={env}
					pkg={pkg}
					open={showRemove}
					onOpenChange={setShowRemove}
				/>
			)}
		</>
	);
}
