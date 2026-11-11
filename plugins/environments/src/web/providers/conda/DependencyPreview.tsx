import { useState, type ReactNode } from "react";

import {
	ArrowRightIcon,
	CircleAlertIcon,
	CopyIcon,
	ListFilterIcon,
	MaximizeIcon,
	MinimizeIcon,
	RefreshCwIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button } from "@kilo-desktop/ui/components/button";
import { toast } from "@kilo-desktop/ui/components/sonner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type {
	CondaPackageChange,
	CondaPackagesPreviewResult,
} from "../../../contracts/providers/conda";
import { PanelList, PanelListRow } from "./PackageSearch";
import {
	PACKAGE_CHANGE_COLORS,
	PACKAGE_CHANGE_ICONS,
	type PackageChangeKind,
} from "./package-change-icons";

export type ChangeCategory = PackageChangeKind;
export type ChangeFilter = "all" | ChangeCategory;

const CATEGORIES: readonly ChangeCategory[] = [
	"upgraded",
	"downgraded",
	"added",
	"removed",
	"rebuilt",
];

const CATEGORY_LABELS: Record<ChangeFilter, string> = {
	all: "All",
	upgraded: "Upgraded",
	downgraded: "Downgraded",
	added: "Added",
	removed: "Removed",
	rebuilt: "Rebuilt",
};

export interface ChangeSection {
	key: ChangeCategory;
	changes: CondaPackageChange[];
	totalCount: number;
}

export interface ChangeSummary {
	sections: ChangeSection[];
	/** Transitive changes across every category, before the filter and search. */
	total: number;
	counts: Record<ChangeCategory, number>;
}

/**
 * Transitive dependency changes in a solver preview. Packages the user chose
 * explicitly are excluded: the preview panel shows only what the solver adds
 * on top of that choice. `filter` and `needle` narrow the sections without
 * changing the totals.
 */
export function summarizeChanges(
	preview: CondaPackagesPreviewResult | null,
	excluded: ReadonlySet<string>,
	filter: ChangeFilter = "all",
	needle = "",
): ChangeSummary {
	const counts = { upgraded: 0, downgraded: 0, added: 0, removed: 0, rebuilt: 0 };
	if (!preview || preview.nothingToDo) return { sections: [], total: 0, counts };
	const query = needle.trim().toLowerCase();
	const sections: ChangeSection[] = [];
	for (const key of CATEGORIES) {
		const transitive = preview[key].filter((change) => !excluded.has(change.name));
		counts[key] = transitive.length;
		if (transitive.length === 0 || (filter !== "all" && filter !== key)) continue;
		sections.push({
			key,
			changes: query
				? transitive.filter((change) => change.name.toLowerCase().includes(query))
				: transitive,
			totalCount: transitive.length,
		});
	}
	const total = CATEGORIES.reduce((sum, key) => sum + counts[key], 0);
	return { sections, total, counts };
}

/**
 * Toolbar filter button for the dependency preview, matching the other
 * list filters in the app. Only "All" and categories with changes are
 * offered; while a new preview resolves, `categories` pins the previous set
 * so the options don't jump.
 */
export function ChangeFilterMenu({
	value,
	onChange,
	counts,
	total,
	resolving = false,
	categories,
	size = "icon-sm",
	qaPrefix,
}: {
	value: ChangeFilter;
	onChange: (value: ChangeFilter) => void;
	counts: Record<ChangeCategory, number>;
	total: number;
	resolving?: boolean;
	categories?: ReadonlySet<ChangeCategory>;
	size?: "icon" | "icon-sm";
	qaPrefix?: string;
}) {
	const visible = CATEGORIES.filter((key) => (categories ? categories.has(key) : counts[key] > 0));
	const filters: ChangeFilter[] = ["all", ...visible];
	const filtered = value !== "all";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant={filtered ? "secondary" : "outline"}
						size={size}
						aria-label={`Filter dependency changes: ${CATEGORY_LABELS[value]}`}
						className="shrink-0"
						data-active={filtered || undefined}
						data-qa-id={qaPrefix ? `${qaPrefix}-filter` : undefined}
					/>
				}
			>
				<ListFilterIcon aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Show</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={value}>
						{filters.map((filter) => (
							<DropdownMenuRadioItem
								key={filter}
								value={filter}
								closeOnClick
								onClick={() => onChange(filter)}
								data-qa-id={qaPrefix ? `${qaPrefix}-filter-${filter}` : undefined}
							>
								{filter === "all" ? null : <CategoryIcon category={filter} />}
								<span className={cn(filter === "all" && "pl-5")}>{CATEGORY_LABELS[filter]}</span>
								<span className="text-muted-foreground ml-auto tabular-nums">
									{resolving ? "–" : filter === "all" ? total : counts[filter]}
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Dependency changes as one bordered list, ordered by category. Each row is a
 * single line — category icon, package name, version change — so the list
 * scans like a table; the filter menu doubles as the icon legend.
 */
export function DependencyChangeList({
	sections,
	qaId,
}: {
	sections: ChangeSection[];
	qaId?: string;
}) {
	const rows = sections.flatMap((section) =>
		section.changes.map((change) => ({ category: section.key, change })),
	);
	if (rows.length === 0) {
		return <p className="text-muted-foreground py-1.5 text-xs">No matching changes.</p>;
	}
	return (
		<PanelList data-qa-id={qaId}>
			{rows.map(({ category, change }) => (
				<PanelListRow key={`${category}:${change.name}`}>
					<CategoryIcon category={category} />
					<span className="sr-only">{CATEGORY_LABELS[category]}</span>
					<span className="min-w-0 flex-1 truncate font-medium" title={change.name}>
						{change.name}
					</span>
					<ChangeVersions category={category} change={change} />
				</PanelListRow>
			))}
		</PanelList>
	);
}

function CategoryIcon({ category }: { category: ChangeCategory }) {
	const Icon = PACKAGE_CHANGE_ICONS[category];
	return (
		<Icon className={cn("size-3.5 shrink-0", PACKAGE_CHANGE_COLORS[category])} aria-hidden="true" />
	);
}

function ChangeVersions({
	category,
	change,
}: {
	category: ChangeCategory;
	change: CondaPackageChange;
}) {
	const className = "text-muted-foreground flex shrink-0 items-center gap-1 tabular-nums";
	if (category === "added") return <span className={className}>{change.toVersion}</span>;
	if (category === "removed") return <span className={className}>{change.fromVersion}</span>;
	return (
		<span className={className}>
			{change.fromVersion}
			<ArrowRightIcon className="size-3" aria-hidden="true" />
			<span className="text-foreground">{change.toVersion}</span>
		</span>
	);
}

/** Solver failure with the raw conda output one click away. */
export function SolverErrorCard({
	message,
	detail,
	qaId,
	onRetry,
}: {
	message: string;
	detail?: string;
	qaId?: string;
	/** Re-runs the solve; the preview has no other retry control. */
	onRetry?: () => void;
}) {
	const [expanded, setExpanded] = useState(false);

	function handleCopy() {
		const text = detail ? `${message}\n\n${detail}` : message;
		navigator.clipboard.writeText(text).then(
			() => toast.success("Copied to clipboard"),
			() => toast.error("Could not copy to clipboard"),
		);
	}

	return (
		<Alert variant="destructive" className={cn("min-h-0", expanded && "flex-1")} data-qa-id={qaId}>
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>Dependency conflict</AlertTitle>
			<AlertDescription className="flex min-h-0 flex-col gap-2">
				<span>{message}</span>
				{detail ? (
					<pre
						className={cn(
							"bg-muted/50 text-foreground/90 overflow-auto rounded-md border p-2.5 font-mono text-xs break-all whitespace-pre-wrap",
							expanded ? "max-h-96" : "max-h-32",
						)}
					>
						{detail}
					</pre>
				) : null}
				<div className="flex items-center gap-1">
					{onRetry ? (
						<Button type="button" variant="outline" size="xs" onClick={onRetry}>
							<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
							Try again
						</Button>
					) : null}
					<div className="ml-auto flex items-center gap-0.5">
						<IconAction label="Copy to clipboard" onClick={handleCopy}>
							<CopyIcon />
						</IconAction>
						{detail ? (
							<IconAction
								label={expanded ? "Collapse details" : "Expand details"}
								onClick={() => setExpanded((value) => !value)}
							>
								{expanded ? <MinimizeIcon /> : <MaximizeIcon />}
							</IconAction>
						) : null}
					</div>
				</div>
			</AlertDescription>
		</Alert>
	);
}

function IconAction({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground"
						aria-label={label}
						onClick={onClick}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
