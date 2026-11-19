import { FolderIcon, FolderPlusIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { FieldDescription } from "@kilo-desktop/ui/components/field";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { FILLED_PANEL_CLASS } from "./filled-styles";
import { joinFolderPath } from "./folder-path";

/**
 * The folder a new folder goes in, with a button to choose another. With
 * `newFolderName` it previews the new folder's full path, keeping the new
 * name visible when the location has to truncate.
 */
export function LocationPicker({
	location,
	canPickDirectories,
	disabled = false,
	newFolderName,
	appearance = "outlined",
	onChoose,
}: {
	appearance?: "outlined" | "filled";
	location: string | null;
	canPickDirectories: boolean;
	disabled?: boolean;
	/** The folder to be made inside `location`; previewed once it is non-empty. */
	newFolderName?: string;
	onChoose(): void;
}) {
	const Icon = newFolderName === undefined ? FolderIcon : FolderPlusIcon;
	const separator = location ? joinFolderPath(location, "").slice(-1) : "/";

	return (
		<>
			<div
				className={cn(
					"flex items-center gap-2 border py-1 pr-1 pl-3",
					appearance === "filled" ? FILLED_PANEL_CLASS : "border-border rounded-lg",
				)}
			>
				<Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
				{location && newFolderName ? (
					<span
						className="flex min-w-0 flex-1 font-mono text-xs"
						title={joinFolderPath(location, newFolderName)}
						data-qa-id="workspace-location-preview"
					>
						<span className="text-muted-foreground min-w-0 truncate">
							{location.replace(/[\\/]+$/, "")}
							{separator}
						</span>
						<span className="text-foreground max-w-[60%] shrink-0 truncate">{newFolderName}</span>
					</span>
				) : (
					<span
						className={
							location
								? "min-w-0 flex-1 truncate font-mono text-xs"
								: "text-muted-foreground min-w-0 flex-1 text-sm"
						}
						title={location ?? undefined}
					>
						{location ?? "No location chosen"}
					</span>
				)}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={!canPickDirectories || disabled}
					aria-label={location ? "Change location" : "Choose location"}
					data-qa-id="workspace-location-choose"
					onClick={onChoose}
				>
					{location ? "Change…" : "Choose…"}
				</Button>
			</div>
			{canPickDirectories ? null : (
				<FieldDescription>Folder selection requires the desktop app.</FieldDescription>
			)}
		</>
	);
}
