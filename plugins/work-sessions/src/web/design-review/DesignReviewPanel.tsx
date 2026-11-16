import { PaletteIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@kilo-desktop/ui/components/button";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { menuSurface } from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	setShowWorkspaceDetails,
	useShowWorkspaceDetails,
} from "../shared/workspace-details-preference";

function Row({
	label,
	checked,
	onChange,
}: {
	readonly label: string;
	readonly checked: boolean;
	readonly onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<div className="flex items-center justify-between gap-4 py-1">
			<label htmlFor={id} className="text-sm">
				{label}
			</label>
			<Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
		</div>
	);
}

/**
 * Dev-only switches for showing designers variants side by side, floating
 * in the window's corner. Portalled to the body so the status bar it is
 * mounted through stays hidden.
 */
export function DesignReviewPanel() {
	const [open, setOpen] = useState(false);
	const showWorkspaceDetails = useShowWorkspaceDetails();
	return createPortal(
		<div data-qa-id="design-review-panel" className="fixed right-3 bottom-3 z-50">
			{open ? (
				<div className={cn(menuSurface, "w-64 p-3")}>
					<div className="mb-2 flex items-center justify-between">
						<span className="text-muted-foreground text-xs font-medium">Design review</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="Close design review"
							onClick={() => setOpen(false)}
						>
							<XIcon />
						</Button>
					</div>
					<Row
						label="Workspace folder paths"
						checked={showWorkspaceDetails}
						onChange={setShowWorkspaceDetails}
					/>
				</div>
			) : (
				<Button
					type="button"
					variant="secondary"
					size="icon-sm"
					aria-label="Design review"
					title="Design review"
					className="rounded-full shadow-md"
					onClick={() => setOpen(true)}
				>
					<PaletteIcon />
				</Button>
			)}
		</div>,
		document.body,
	);
}
