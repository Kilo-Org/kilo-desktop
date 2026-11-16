import {
	CircleArrowDownIcon,
	CircleArrowUpIcon,
	CircleMinusIcon,
	CirclePlusIcon,
	RefreshCcwDotIcon,
	type LucideIcon,
} from "lucide-react";

export type PackageChangeKind = "upgraded" | "downgraded" | "added" | "removed" | "rebuilt";

/**
 * One glyph and status colour per kind of package change, shared by the
 * package list's update indicator, update actions, and the dependency
 * preview so an "update" reads the same everywhere. Action buttons use the
 * glyph uncoloured; status indicators pair it with the colour.
 */
export const PACKAGE_CHANGE_ICONS: Record<PackageChangeKind, LucideIcon> = {
	upgraded: CircleArrowUpIcon,
	downgraded: CircleArrowDownIcon,
	added: CirclePlusIcon,
	removed: CircleMinusIcon,
	rebuilt: RefreshCcwDotIcon,
};

export const PACKAGE_CHANGE_COLORS: Record<PackageChangeKind, string> = {
	upgraded: "text-success",
	downgraded: "text-warning",
	added: "text-info",
	removed: "text-destructive",
	rebuilt: "text-muted-foreground",
};

export const UpdateIcon = PACKAGE_CHANGE_ICONS.upgraded;
