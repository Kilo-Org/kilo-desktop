import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import {
	BotIcon,
	BriefcaseBusinessIcon,
	ChevronsUpDownIcon,
	CircleAlertIcon,
	CodeXmlIcon,
	DatabaseIcon,
	EarthIcon,
	ExternalLinkIcon,
	FolderIcon,
	LibraryIcon,
	ListFilterIcon,
	LockIcon,
	PaletteIcon,
	PlugIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	SearchXIcon,
	SparklesIcon,
	TagIcon,
	Trash2Icon,
	WorkflowIcon,
	ZapIcon,
} from "lucide-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	MARKETPLACE_TELEMETRY_EVENTS,
	type MarketplaceIncludedItem,
	type MarketplaceInstalled,
	type MarketplaceItem,
	type MarketplaceItemRef,
	type MarketplaceMcpStatus,
	type MarketplaceMutationInput,
	type MarketplaceSnapshot,
	type MarketplaceTarget,
	type MarketplaceType,
	type McpMethod,
	type McpParameter,
} from "../contracts/index";
import { filterMarketplaceItems, installedScopes, matchesSearch } from "./marketplace-filter";
import { mcpInstallContent } from "../contracts/mcp-config";
import { McpConfigReview } from "./McpConfigReview";
import { mcpConfigPreview } from "./mcp-config-preview";
import { mcpLaunchCommand, missingCommand } from "./mcp-commands";
import { MissingCommandAlert, MissingCommandFix, useMissingCommand } from "./MissingCommandHelp";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import {
	marketplaceQueryKey,
	marketplaceQueryOptions,
	useActiveWorkspaceId,
	useMarketplace,
	useMarketplaceMutation,
	useOpenExternal,
	useTrack,
} from "./marketplace";
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
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button, buttonVariants } from "@kilo-desktop/ui/components/button";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import { Card } from "@kilo-desktop/ui/components/card";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@kilo-desktop/ui/components/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Toggle } from "@kilo-desktop/ui/components/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

const TYPE_OPTIONS: Array<{ value: MarketplaceType; label: string; noun: string }> = [
	{ value: "agent", label: "Agents", noun: "agents" },
	{ value: "mcp", label: "MCPs", noun: "MCPs" },
	{ value: "skill", label: "Skills", noun: "skills" },
];
const COUNT_CLASS = "inline-block min-w-[3ch] text-right text-2xs tabular-nums opacity-60";
const TYPE_ICON_STYLES: Record<MarketplaceType, string> = {
	agent: "text-emerald-500!",
	mcp: "text-sky-500!",
	skill: "text-amber-500!",
};
const ITEM_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});
const CATEGORY_PREVIEW_LIMIT = 6;

function itemTelemetryData(
	item: MarketplaceItemRef & { name: string },
	target?: MarketplaceInstalled["scope"],
) {
	return {
		itemId: item.id,
		itemName: item.name,
		itemType: item.type,
		...(target ? { target } : {}),
	};
}
const CATEGORY_TILE_PLACEHOLDERS = [
	"first",
	"second",
	"third",
	"fourth",
	"fifth",
	"sixth",
	"seventh",
];
const LIST_FORMAT = new Intl.ListFormat("en", { type: "conjunction" });

type InstallDestination = { label: string; input: MarketplaceMutationInput };
type InstallFailure = InstallDestination & { message: string };
type InstallOutcome = { failed: InstallFailure[]; succeeded: string[] };

type InstallDialogProps = {
	item: MarketplaceItem;
	installed: MarketplaceInstalled[];
	targets: MarketplaceTarget[];
	defaultWorkspaceId: string | null;
	onInstalled(): void;
	onClose(): void;
};

type RemoveSelection = {
	item: MarketplaceItemRef & { name: string };
	installed: MarketplaceInstalled;
};

type MarketplaceMode = "installed" | "browse";
type ConfiguredItem = MarketplaceItemRef & {
	name: string;
	description: string;
	category: string;
};
type MarketplaceListItem = MarketplaceItem | MarketplaceIncludedItem | ConfiguredItem;
type MarketplaceListRow = {
	item: MarketplaceListItem;
	installations: MarketplaceInstalled[];
	key: string;
};

function filterIncludedItems(
	items: readonly MarketplaceIncludedItem[],
	search: string,
): MarketplaceIncludedItem[] {
	return items.filter((item) =>
		matchesSearch(search, [item.name, item.description, item.category]),
	);
}

function toggled<T>(set: ReadonlySet<T>, value: T, on = !set.has(value)): Set<T> {
	const next = new Set(set);
	if (on) next.add(value);
	else next.delete(value);
	return next;
}

function configuredItem(installation: MarketplaceInstalled): ConfiguredItem {
	return {
		type: installation.type,
		id: installation.id,
		name:
			installation.name ??
			installation.id
				.split(/[-_]/)
				.filter(Boolean)
				.map((word, index) =>
					index === 0 ? `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}` : word,
				)
				.join(" "),
		description: installation.description ?? "Configured in Kilo.",
		category: installation.category ?? "Custom",
	};
}

function isCatalogItem(item: MarketplaceListItem): item is MarketplaceItem {
	return "content" in item;
}

function installationLabel(
	installation: MarketplaceInstalled,
	targets: MarketplaceTarget[],
): string {
	if (installation.scope === "global") return "All workspaces";
	return (
		targets.find((target) => target.id === installation.workspaceId)?.name ??
		(installation.workspaceId
			? `Unavailable workspace (${installation.workspaceId})`
			: "Unavailable workspace")
	);
}

function installationKey(installation: MarketplaceInstalled): string {
	return installation.scope === "workspace" && installation.workspaceId
		? installation.workspaceId
		: installation.scope;
}

function installationMatchesWorkspaces(
	installation: MarketplaceInstalled,
	excludedWorkspaceIds: ReadonlySet<string>,
): boolean {
	return (
		installation.scope === "global" ||
		!installation.workspaceId ||
		!excludedWorkspaceIds.has(installation.workspaceId)
	);
}

function installedWorkspaceIds(installations: readonly MarketplaceInstalled[]): Set<string> {
	return new Set(
		installations.flatMap((installation) =>
			installation.scope === "workspace" && installation.workspaceId
				? [installation.workspaceId]
				: [],
		),
	);
}

function uninstalledTargets(
	installations: readonly MarketplaceInstalled[],
	targets: readonly MarketplaceTarget[],
): MarketplaceTarget[] {
	const installedIds = installedWorkspaceIds(installations);
	return targets.filter((target) => !installedIds.has(target.id));
}

function hasInstallableLocation(
	installations: readonly MarketplaceInstalled[],
	targets: readonly MarketplaceTarget[],
): boolean {
	return (
		!installations.some((installation) => installation.scope === "global") ||
		uninstalledTargets(installations, targets).length > 0
	);
}

type MarketplaceRowsView = {
	search: string;
	browseCategories: ReadonlySet<string>;
	excludedWorkspaceIds: ReadonlySet<string>;
	mode: MarketplaceMode;
	showBuiltIn: boolean;
	showUser: boolean;
};

/** Catalog, configured-only and included items for the current mode and filters, by name. */
function marketplaceRows(
	items: readonly MarketplaceItem[],
	installed: readonly MarketplaceInstalled[],
	includedItems: readonly MarketplaceIncludedItem[],
	{
		search,
		browseCategories,
		excludedWorkspaceIds,
		mode,
		showBuiltIn,
		showUser,
	}: MarketplaceRowsView,
): MarketplaceListRow[] {
	const marketplace = filterMarketplaceItems(items, installed, {
		search,
		category: mode === "browse" ? [...browseCategories] : [],
		status: mode === "installed" ? "installed" : "all",
	});
	const included =
		mode === "installed" && showBuiltIn ? filterIncludedItems(includedItems, search) : [];
	const marketplaceRows =
		mode !== "installed" || showUser
			? marketplace
					.map((item) => ({
						item,
						installations: installedScopes(item, installed).filter(
							(installation) =>
								mode !== "installed" ||
								installationMatchesWorkspaces(installation, excludedWorkspaceIds),
						),
						key: `${item.type}:${item.id}`,
					}))
					.filter((row) => mode !== "installed" || row.installations.length > 0)
			: [];
	const configuredByItem = new Map<
		string,
		{ item: ConfiguredItem; installations: MarketplaceInstalled[]; key: string }
	>();
	if (mode === "installed" && showUser) {
		for (const installation of installed) {
			if (!installationMatchesWorkspaces(installation, excludedWorkspaceIds)) continue;
			if (items.some((item) => item.type === installation.type && item.id === installation.id)) {
				continue;
			}
			const key = `${installation.type}:${installation.id}`;
			const existing = configuredByItem.get(key);
			if (existing) {
				existing.installations.push(installation);
				continue;
			}
			const item = configuredItem(installation);
			if (!matchesSearch(search, [item.name, item.description, item.category])) {
				continue;
			}
			configuredByItem.set(key, { item, installations: [installation], key });
		}
	}
	const configuredRows = [...configuredByItem.values()];
	const includedRows = included.map((item) => ({
		item,
		installations: [],
		key: `included:${item.type}:${item.id}`,
	}));
	return [...marketplaceRows, ...configuredRows, ...includedRows].toSorted((left, right) => {
		const byName = ITEM_NAME_COLLATOR.compare(left.item.name, right.item.name);
		if (byName !== 0) return byName;
		return left.key.localeCompare(right.key);
	});
}

/**
 * Rows matching the deferred search and current filters, with per-type counts.
 * Filtering is the expensive part the deferral protects, so both live here.
 */
function useDeferredMarketplaceRows(
	snapshot: MarketplaceSnapshot | undefined,
	search: string,
	view: Omit<MarketplaceRowsView, "search">,
) {
	const deferredSearch = useDeferredValue(search);
	const filtered = marketplaceRows(
		snapshot?.items ?? [],
		snapshot?.installed ?? [],
		snapshot?.included ?? [],
		{ ...view, search: deferredSearch },
	);
	const typeCounts: Record<MarketplaceType, number> = { agent: 0, mcp: 0, skill: 0 };
	for (const row of filtered) typeCounts[row.item.type] += 1;
	return { searching: deferredSearch.trim().length > 0, filtered, typeCounts };
}

/** Rows grouped by category, sections ordered by display name. */
function catalogSectionsOf(rows: readonly MarketplaceListRow[]) {
	const rowsByCategory = new Map<string, MarketplaceListRow[]>();
	for (const row of rows) {
		const categoryRows = rowsByCategory.get(row.item.category) ?? [];
		categoryRows.push(row);
		rowsByCategory.set(row.item.category, categoryRows);
	}
	return [...rowsByCategory.entries()]
		.map(([value, categoryRows]) => ({
			value,
			label: categoryDisplayName(value),
			rows: categoryRows,
		}))
		.toSorted((left, right) => ITEM_NAME_COLLATOR.compare(left.label, right.label));
}

function includedLocationLabel(item: MarketplaceIncludedItem): string {
	return item.installedIn === "Kilo" ? "Built-in" : item.installedIn;
}

function summaryDescription(description: string): string {
	const trimmed = description.trim();
	const period = trimmed.indexOf(".");
	return period === -1 ? trimmed : trimmed.slice(0, period + 1);
}

function itemLink(item: MarketplaceListItem): string | undefined {
	if (!isCatalogItem(item)) return undefined;
	if (item.type === "skill") return item.githubUrl;
	if (item.type === "mcp") return item.url;
	return item.authorUrl;
}

function TypeIcon({ type }: { type: MarketplaceType }) {
	switch (type) {
		case "agent":
			return <BotIcon aria-hidden />;
		case "skill":
			return <SparklesIcon aria-hidden />;
		case "mcp":
			return <PlugIcon aria-hidden />;
		default: {
			const exhaustive: never = type;
			return String(exhaustive);
		}
	}
}

function MarketplaceItemIcon({ item }: { item: MarketplaceListItem }) {
	return (
		<span className={cn("contents", TYPE_ICON_STYLES[item.type])}>
			<TypeIcon type={item.type} />
		</span>
	);
}

function TypeCount({ count, loading }: { count: number; loading: boolean }) {
	return (
		<span className={COUNT_CLASS}>{loading ? <SkeletonText className="w-[2ch]" /> : count}</span>
	);
}

function TypeToggles({
	selected,
	total,
	counts,
	loading,
	onToggle,
	onClear,
}: {
	selected: ReadonlySet<MarketplaceType>;
	total: number;
	counts: Record<MarketplaceType, number>;
	loading: boolean;
	onToggle(type: MarketplaceType): void;
	onClear(): void;
}) {
	return (
		<div
			role="group"
			aria-label="Marketplace item type"
			className="flex max-w-full shrink-0 flex-wrap items-center gap-1"
		>
			<Toggle
				size="sm"
				pressed={selected.size === 0}
				onPressedChange={onClear}
				data-qa-id="marketplace-type-all"
			>
				All <TypeCount count={total} loading={loading} />
			</Toggle>
			{TYPE_OPTIONS.map((option) => (
				<Toggle
					key={option.value}
					size="sm"
					pressed={selected.has(option.value)}
					onPressedChange={() => onToggle(option.value)}
					data-qa-id={`marketplace-type-${option.value}`}
				>
					<span className={cn("shrink-0 [&>svg]:size-3.5", TYPE_ICON_STYLES[option.value])}>
						<TypeIcon type={option.value} />
					</span>
					{option.label} <TypeCount count={counts[option.value]} loading={loading} />
				</Toggle>
			))}
		</div>
	);
}

function CategoryToggles({
	categories,
	selected,
	loading,
	onToggle,
	onClear,
}: {
	categories: readonly string[];
	selected: ReadonlySet<string>;
	loading: boolean;
	onToggle(category: string): void;
	onClear(): void;
}) {
	return (
		<div
			role="group"
			aria-label="Marketplace categories"
			// 12.5rem fits the longest known category label ("Web Automation", ~191px) beside its icon tile.
			className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(min(12.5rem,100%),1fr))] gap-2"
			data-qa-id="marketplace-category-tiles"
		>
			<CategoryTile
				label="All categories"
				icon={<TagIcon />}
				pressed={selected.size === 0}
				onPressedChange={onClear}
				qaId="marketplace-category-all"
			/>
			{loading
				? CATEGORY_TILE_PLACEHOLDERS.map((placeholder) => (
						<CategoryTilePlaceholder key={placeholder} />
					))
				: null}
			{categories.map((entry) => (
				<CategoryTile
					key={entry}
					label={categoryDisplayName(entry)}
					icon={<CategoryIcon category={entry} />}
					pressed={selected.has(entry)}
					onPressedChange={() => onToggle(entry)}
					qaId={`marketplace-category-${entry}`}
				/>
			))}
		</div>
	);
}

function CategoryTile({
	label,
	icon,
	pressed,
	onPressedChange,
	qaId,
}: {
	label: string;
	icon: ReactNode;
	pressed: boolean;
	onPressedChange(): void;
	qaId: string;
}) {
	return (
		<Toggle
			pressed={pressed}
			onPressedChange={onPressedChange}
			className="hover:bg-muted h-auto min-w-0 justify-start gap-2.5 px-2 py-2"
			data-qa-id={qaId}
		>
			<span className="bg-card text-muted-foreground flex shrink-0 items-center justify-center rounded-md p-2 [&>svg]:size-4">
				{icon}
			</span>
			<span className="text-left text-sm leading-tight">{label}</span>
		</Toggle>
	);
}

/**
 * Mirrors CategoryTile's padding, icon tile, and label line so the grid keeps its shape. The real
 * icon tile is 30px: Toggle's unsized-svg rule (size-3.5) outranks the tile's `[&>svg]:size-4`.
 */
function CategoryTilePlaceholder() {
	return (
		<div
			aria-hidden="true"
			className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2"
			data-qa-id="marketplace-category-placeholder"
		>
			<Skeleton className="size-7.5 shrink-0" />
			<span className="text-sm leading-tight">
				<SkeletonText className="w-24" />
			</span>
		</div>
	);
}

function InstalledFilterMenu({
	showUser,
	showBuiltIn,
	targets,
	excludedWorkspaceIds,
	onShowUserChange,
	onShowBuiltInChange,
	onWorkspaceChange,
	onReset,
}: {
	showUser: boolean;
	showBuiltIn: boolean;
	targets: readonly MarketplaceTarget[];
	excludedWorkspaceIds: ReadonlySet<string>;
	onShowUserChange(checked: boolean): void;
	onShowBuiltInChange(checked: boolean): void;
	onWorkspaceChange(workspaceId: string, checked: boolean): void;
	onReset(): void;
}) {
	const customized = !showUser || showBuiltIn || excludedWorkspaceIds.size > 0;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant={customized ? "secondary" : "outline"}
						size="icon-sm"
						aria-label="Filter installed items"
						data-qa-id="marketplace-filter-menu"
						data-active={customized || undefined}
						className="shrink-0"
					/>
				}
			>
				<ListFilterIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-72">
				<DropdownMenuGroup>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="w-full" data-qa-id="marketplace-show-filter">
							Show
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuGroup>
								<DropdownMenuCheckboxItem
									checked={showUser}
									closeOnClick={false}
									onCheckedChange={(checked) => onShowUserChange(checked === true)}
									data-qa-id="marketplace-user-filter"
								>
									User
								</DropdownMenuCheckboxItem>
								<DropdownMenuCheckboxItem
									checked={showBuiltIn}
									closeOnClick={false}
									onCheckedChange={(checked) => onShowBuiltInChange(checked === true)}
									data-qa-id="marketplace-built-in-filter"
								>
									Built-in
								</DropdownMenuCheckboxItem>
							</DropdownMenuGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuGroup>
				{targets.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
							<div data-qa-id="marketplace-workspace-filter-list">
								{targets.map((target) => (
									<DropdownMenuCheckboxItem
										key={target.id}
										checked={!excludedWorkspaceIds.has(target.id)}
										closeOnClick={false}
										onCheckedChange={(checked) => onWorkspaceChange(target.id, checked === true)}
										data-qa-id={`marketplace-workspace-filter-${target.id}`}
									>
										<FolderIcon
											className="text-muted-foreground size-3.5 shrink-0"
											{...(target.color ? { color: target.color } : {})}
											aria-hidden
											data-slot="marketplace-workspace-icon"
										/>
										<span className="truncate">{target.name}</span>
									</DropdownMenuCheckboxItem>
								))}
							</div>
						</DropdownMenuGroup>
					</>
				) : null}
				{customized ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem onClick={onReset} data-qa-id="marketplace-reset-filters">
								Reset filters
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function CategoryIcon({ category }: { category: string }) {
	switch (category.toLocaleLowerCase()) {
		case "business":
			return <BriefcaseBusinessIcon />;
		case "creative-media":
			return <PaletteIcon />;
		case "data":
			return <DatabaseIcon />;
		case "development":
		case "engineering":
			return <CodeXmlIcon />;
		case "automation":
		case "observability":
			return <WorkflowIcon />;
		case "productivity":
			return <ZapIcon />;
		case "search":
		case "knowledge":
		case "research":
			return <SearchIcon />;
		case "web-automation":
			return <EarthIcon />;
		default:
			return <TagIcon />;
	}
}

function categoryDisplayName(category: string): string {
	return category
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`)
		.join(" ");
}

function SourceLinkButton({
	url,
	onOpenLink,
	qaId,
}: {
	url: string;
	onOpenLink(url: string): void;
	qaId: string;
}) {
	const label = "View source";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<ExternalLink
						href={url}
						onOpen={onOpenLink}
						className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
						aria-label={label}
						data-qa-id={qaId}
					/>
				}
			>
				<ExternalLinkIcon aria-hidden />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function ItemMetadata({
	item,
	author,
	onOpenLink,
	categoryQaId,
	authorQaId,
	authorClassName = "text-muted-foreground",
	className,
}: {
	item: MarketplaceListItem;
	author: string;
	onOpenLink(url: string): void;
	categoryQaId?: string;
	authorQaId: string;
	authorClassName?: string;
	className?: string;
}) {
	const link = itemLink(item);
	return (
		<div className={cn("flex min-w-0 items-center gap-3 text-xs", className)}>
			<span className={cn("min-w-0 truncate", authorClassName)} data-qa-id={authorQaId}>
				By {author}
			</span>
			{link ? (
				<SourceLinkButton
					url={link}
					onOpenLink={onOpenLink}
					qaId={`marketplace-source-${item.type}-${item.id}`}
				/>
			) : null}
			<Badge variant="secondary" data-qa-id={categoryQaId}>
				{categoryDisplayName(item.category)}
			</Badge>
		</div>
	);
}

function MarketplaceCardActions({
	item,
	installations,
	targets,
	canInstall,
	onInstall,
}: {
	item: MarketplaceItem;
	installations: MarketplaceInstalled[];
	targets: MarketplaceTarget[];
	canInstall: boolean;
	onInstall(item: MarketplaceItem): void;
}) {
	return (
		<div className="ml-auto flex shrink-0 items-center gap-1.5">
			{installations.length > 0 ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="text-muted-foreground text-2xs h-7 shrink-0 rounded-md px-2"
								data-qa-id={`marketplace-installed-badge-${item.type}-${item.id}`}
							/>
						}
					>
						Installed
					</TooltipTrigger>
					<TooltipContent side="bottom" align="end" className="block w-64">
						<div
							className="grid gap-1.5"
							data-qa-id={`marketplace-installed-locations-${item.type}-${item.id}`}
						>
							<p
								className="font-medium"
								data-qa-id={`marketplace-installed-title-${item.type}-${item.id}`}
							>
								Installed in
							</p>
							{installations.map((entry) => (
								<div key={installationKey(entry)} className="flex min-w-0 items-center gap-2">
									{entry.scope === "global" ? (
										<EarthIcon className="size-3.5 shrink-0" aria-hidden />
									) : (
										<FolderIcon className="size-3.5 shrink-0" aria-hidden />
									)}
									<span className="truncate">{installationLabel(entry, targets)}</span>
								</div>
							))}
						</div>
					</TooltipContent>
				</Tooltip>
			) : null}
			<Tooltip>
				<TooltipTrigger render={<span className="inline-flex shrink-0" />}>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						className="size-7 opacity-0 transition-opacity group-focus-within/catalog-card:opacity-100 group-hover/catalog-card:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
						disabled={!canInstall}
						aria-label={canInstall ? `Install ${item.name}` : "Installed everywhere"}
						onClick={() => onInstall(item)}
						data-qa-id={`marketplace-install-${item.type}-${item.id}`}
					>
						<PlusIcon aria-hidden />
					</Button>
				</TooltipTrigger>
				<TooltipContent>{canInstall ? "Install" : "Installed everywhere"}</TooltipContent>
			</Tooltip>
		</div>
	);
}

function MarketplaceCatalogCard({
	item,
	installations,
	targets,
	onInstall,
	onOpenLink,
}: {
	item: MarketplaceItem;
	installations: MarketplaceInstalled[];
	targets: MarketplaceTarget[];
	onInstall(item: MarketplaceItem): void;
	onOpenLink(url: string): void;
}) {
	const canInstall = hasInstallableLocation(installations, targets);
	return (
		<Card
			size="sm"
			className="group/catalog-card hover:border-foreground/25 min-w-0 gap-3 p-3 transition-colors"
			data-qa-id={`marketplace-item-${item.type}-${item.id}`}
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<span className="border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
					<MarketplaceItemIcon item={item} />
				</span>
				<h3
					className="min-w-0 truncate text-sm font-medium"
					data-qa-id={`marketplace-name-${item.type}-${item.id}`}
				>
					{item.name}
				</h3>
				<MarketplaceCardActions
					item={item}
					installations={installations}
					targets={targets}
					canInstall={canInstall}
					onInstall={onInstall}
				/>
			</div>
			<p
				className="text-muted-foreground line-clamp-2 min-h-8 w-full max-w-none self-stretch text-xs leading-4"
				data-qa-id={`marketplace-card-description-${item.type}-${item.id}`}
			>
				{item.description}
			</p>
			<ItemMetadata
				item={item}
				author={item.author ?? "Unknown"}
				onOpenLink={onOpenLink}
				authorQaId={`marketplace-row-author-${item.type}-${item.id}`}
				categoryQaId={`marketplace-card-category-${item.type}-${item.id}`}
				className="gap-1.5"
			/>
		</Card>
	);
}

type InstallationStatusLookup = (
	installation: MarketplaceInstalled,
) => MarketplaceMcpStatus | undefined;

function installationStatusLookup(
	item: MarketplaceListItem,
	mcpInstallationStatuses: Record<string, MarketplaceMcpStatus>,
	selectedMcpStatus: MarketplaceMcpStatus | undefined,
	selectedWorkspaceId: string | null,
): InstallationStatusLookup {
	return (installation: MarketplaceInstalled) => {
		if (item.type !== "mcp") return undefined;
		const scopedStatus = mcpInstallationStatuses[`${item.id}:${installationKey(installation)}`];
		if (scopedStatus) return scopedStatus;
		const isSelectedLocation = selectedWorkspaceId
			? installation.workspaceId === selectedWorkspaceId
			: installation.scope === "global";
		return isSelectedLocation ? selectedMcpStatus : undefined;
	};
}

type InstalledDetailsProps = {
	item: MarketplaceListItem;
	installations: MarketplaceInstalled[];
	targets: MarketplaceTarget[];
	installationStatus: InstallationStatusLookup;
	authenticatingWorkspaceId: string | null | undefined;
	onAddLocation(item: MarketplaceItem): void;
	onAuthenticate(id: string, workspaceId?: string): void;
	onRemove(item: MarketplaceItemRef & { name: string }, entry: MarketplaceInstalled): void;
	onOpenLink(url: string): void;
};

type InstalledCardProps = Omit<InstalledDetailsProps, "installationStatus"> & {
	mcpInstallationStatuses: Record<string, MarketplaceMcpStatus>;
	selectedMcpStatus: MarketplaceMcpStatus | undefined;
	selectedWorkspaceId: string | null;
	detailsOpen: boolean;
	onToggleDetails(): void;
};

function InstalledCard({
	item,
	installations,
	targets,
	detailsOpen,
	mcpInstallationStatuses,
	selectedMcpStatus,
	selectedWorkspaceId,
	authenticatingWorkspaceId,
	onToggleDetails,
	onAddLocation,
	onAuthenticate,
	onRemove,
	onOpenLink,
}: InstalledCardProps) {
	const included = "installedIn" in item;
	const installationStatus = installationStatusLookup(
		item,
		mcpInstallationStatuses,
		selectedMcpStatus,
		selectedWorkspaceId,
	);
	const hasStatus = (status: MarketplaceMcpStatus["status"]) =>
		installations.some((installation) => installationStatus(installation)?.status === status);
	const needsAuth = hasStatus("needs_auth");
	const needsClientRegistration = hasStatus("needs_client_registration");
	const failed = hasStatus("failed");
	const disabled = hasStatus("disabled");
	const locationCount = included ? 1 : installations.length;
	const primaryInstallation = installations[0];
	const primaryDestination = primaryInstallation
		? installationKey(primaryInstallation)
		: "included";
	const locationSummary = included
		? includedLocationLabel(item)
		: locationCount === 1
			? installationLabel(primaryInstallation!, targets)
			: `${locationCount} places`;
	const detailsId = `marketplace-card-details-${item.type}-${item.id}`;
	const toggleLabel = `Toggle ${item.name} details`;

	return (
		<Collapsible
			className="max-w-full min-w-0"
			open={detailsOpen}
			onOpenChange={onToggleDetails}
			data-qa-id={`marketplace-item-${item.type}-${item.id}`}
			data-state={detailsOpen ? "details-open" : "summary"}
		>
			<SummaryCard.Row data-qa-id={`marketplace-card-header-${item.type}-${item.id}`}>
				<SummaryCard.Trigger
					type="button"
					aria-label={toggleLabel}
					data-qa-id={`marketplace-card-trigger-${item.type}-${item.id}`}
				>
					<SummaryCard.Icon>
						<MarketplaceItemIcon item={item} />
					</SummaryCard.Icon>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<span className="truncate" data-qa-id={`marketplace-name-${item.type}-${item.id}`}>
								{item.name}
							</span>
							{needsClientRegistration ? (
								<Badge
									variant="destructive"
									data-qa-id={`marketplace-mcp-blocked-${item.type}-${item.id}-${primaryDestination}`}
								>
									<CircleAlertIcon aria-hidden="true" />
									Requires setup
								</Badge>
							) : null}
						</SummaryCard.Title>
						<SummaryCard.Description
							data-qa-id={`marketplace-card-summary-${item.type}-${item.id}`}
						>
							{summaryDescription(item.description)}
						</SummaryCard.Description>
					</SummaryCard.Content>
				</SummaryCard.Trigger>

				<SummaryCard.Actions className="gap-1.5">
					{included ? (
						<span
							className="text-muted-foreground inline-flex size-7 items-center justify-center"
							aria-label="Built in"
							title="Built in"
							data-qa-id={`marketplace-included-${item.type}-${item.id}`}
						>
							<LockIcon className="size-3.5" aria-hidden="true" />
						</span>
					) : null}
					{item.type === "mcp" ? (
						<span className={cn(HEADER_SLOT_CLASS, "w-[8.25rem] justify-center")}>
							{failed ? (
								<Badge
									variant="destructive"
									className="border-destructive/50"
									data-qa-id={`marketplace-mcp-failed-${item.id}`}
								>
									<CircleAlertIcon aria-hidden="true" />
									Needs attention
								</Badge>
							) : needsAuth ? (
								<Badge variant="outline" data-qa-id={`marketplace-mcp-auth-needed-${item.id}`}>
									<CircleAlertIcon aria-hidden="true" />
									Needs sign-in
								</Badge>
							) : disabled ? (
								<Badge variant="secondary" data-qa-id={`marketplace-mcp-disabled-${item.id}`}>
									Disabled
								</Badge>
							) : null}
						</span>
					) : null}
					<span className={cn(HEADER_SLOT_CLASS, "hidden w-36 justify-end @xl:flex")}>
						<Badge
							variant="secondary"
							className="max-w-full"
							data-qa-id={`marketplace-card-location-summary-${item.type}-${item.id}`}
						>
							{included || primaryInstallation?.scope === "global" ? (
								<EarthIcon aria-hidden="true" />
							) : (
								<FolderIcon aria-hidden="true" />
							)}
							<span className="truncate">{locationSummary}</span>
						</Badge>
					</span>
					<SummaryCard.Toggle
						label={toggleLabel}
						open={detailsOpen}
						data-qa-id={`marketplace-card-chevron-${item.type}-${item.id}`}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>
				<div
					id={detailsId}
					className="border-border bg-background/60 border-t p-4"
					data-qa-id={detailsId}
				>
					<InstalledDetails
						item={item}
						installations={installations}
						targets={targets}
						installationStatus={installationStatus}
						authenticatingWorkspaceId={authenticatingWorkspaceId}
						onAddLocation={onAddLocation}
						onAuthenticate={onAuthenticate}
						onRemove={onRemove}
						onOpenLink={onOpenLink}
					/>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

// Fixed-width header slots keep badges and description truncation aligned
// across rows. SummaryCard.Actions re-enables pointer events on its children so
// buttons there stay clickable; these slots only hold informational badges, so
// clicks fall through to the row's expand overlay instead.
const HEADER_SLOT_CLASS = "pointer-events-none! flex min-w-0 shrink-0";

function InstalledDetails({
	item,
	installations,
	targets,
	installationStatus,
	authenticatingWorkspaceId,
	onAddLocation,
	onAuthenticate,
	onRemove,
	onOpenLink,
}: InstalledDetailsProps) {
	const included = "installedIn" in item;
	const author = included
		? item.installedIn
		: isCatalogItem(item)
			? (item.author ?? "Unknown")
			: "Kilo";
	const canAddLocation = isCatalogItem(item) && hasInstallableLocation(installations, targets);

	return (
		<div className="grid min-w-0 items-start gap-4 @xl:grid-cols-[minmax(0,1fr)_18rem]">
			<FieldSet className="min-w-0 gap-2">
				<FieldContent>
					<FieldLegend variant="label" className="mb-0">
						About
					</FieldLegend>
					<FieldDescription className="break-words">{item.description}</FieldDescription>
				</FieldContent>
				<ItemMetadata
					item={item}
					author={author}
					onOpenLink={onOpenLink}
					categoryQaId={`marketplace-card-category-${item.type}-${item.id}`}
					authorQaId={`marketplace-card-author-${item.type}-${item.id}`}
					authorClassName="text-foreground"
				/>
			</FieldSet>

			<FieldSet className="min-w-0 gap-2">
				<div className="flex items-center justify-between gap-3">
					<FieldLegend variant="label" className="mb-0">
						Installed in
					</FieldLegend>
					{canAddLocation ? (
						<Button
							type="button"
							variant="outline"
							size="icon-xs"
							className="shrink-0"
							aria-label="Add location"
							onClick={() => onAddLocation(item)}
							data-qa-id={`marketplace-add-location-${item.type}-${item.id}`}
						>
							<PlusIcon aria-hidden />
						</Button>
					) : null}
				</div>
				<div className="border-border divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
					{included ? (
						<div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
							<LockIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
							<span
								className="min-w-0 flex-1 truncate text-sm font-medium"
								data-qa-id={`marketplace-installed-in-${item.type}-${item.id}`}
							>
								{includedLocationLabel(item)}
							</span>
						</div>
					) : (
						installations.map((installation) => {
							const destination = installationKey(installation);
							const status = installationStatus(installation);
							const authenticating =
								status?.status === "needs_auth" &&
								authenticatingWorkspaceId === (installation.workspaceId ?? null);
							const unavailable =
								installation.scope === "workspace" &&
								!targets.some((target) => target.id === installation.workspaceId);
							const location = installationLabel(installation, targets);
							const missingLaunchCommand =
								status?.status === "failed" ? missingCommand(status.error) : undefined;
							return (
								<div key={destination} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
									{installation.scope === "global" ? (
										<EarthIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
									) : (
										<FolderIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
									)}
									<span className="min-w-0 flex-1">
										<span
											className="block truncate text-sm font-medium"
											data-qa-id={`marketplace-installed-in-${item.type}-${item.id}-${destination}`}
										>
											{location}
										</span>
										{(status?.status === "failed" ||
											status?.status === "needs_client_registration") &&
										!missingLaunchCommand ? (
											<span
												className="text-destructive text-2xs block leading-4 break-words"
												data-qa-id={`marketplace-mcp-error-${item.id}-${destination}`}
											>
												{status.error}
											</span>
										) : null}
									</span>
									{status?.status === "needs_auth" ? (
										<Button
											type="button"
											size="xs"
											className="shrink-0"
											disabled={authenticating}
											onClick={() => onAuthenticate(item.id, installation.workspaceId)}
											data-qa-id={`marketplace-authenticate-mcp-${item.id}-${destination}`}
										>
											{authenticating ? "Signing in" : "Sign in"}
										</Button>
									) : status?.status === "needs_client_registration" ? (
										<span className="text-destructive text-2xs shrink-0 font-medium">
											Requires setup
										</span>
									) : missingLaunchCommand ? (
										<MissingCommandFix
											command={missingLaunchCommand}
											qaId={`marketplace-mcp-fix-${item.id}-${destination}`}
										/>
									) : status?.status === "failed" ? (
										<span className="text-destructive text-2xs shrink-0 font-medium">Failed</span>
									) : status?.status === "disabled" ? (
										<span className="text-muted-foreground text-2xs shrink-0 font-medium">
											Disabled
										</span>
									) : status?.status === "connected" ? (
										<Badge variant="secondary">Connected</Badge>
									) : null}
									{unavailable ? (
										<Tooltip>
											<TooltipTrigger
												render={
													<span
														role="img"
														tabIndex={0}
														className="text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center"
														aria-label="Unavailable"
														data-qa-id={`marketplace-locked-${item.type}-${item.id}-${destination}`}
													/>
												}
											>
												<LockIcon className="size-3.5" aria-hidden />
											</TooltipTrigger>
											<TooltipContent>
												This workspace is unavailable, so it can’t be changed here
											</TooltipContent>
										</Tooltip>
									) : (
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="hover:text-destructive shrink-0"
											aria-label={`Remove ${item.name} from ${location}`}
											onClick={() => onRemove(item, installation)}
											data-qa-id={`marketplace-remove-${item.type}-${item.id}-${destination}`}
										>
											<Trash2Icon aria-hidden />
										</Button>
									)}
								</div>
							);
						})
					)}
				</div>
			</FieldSet>
		</div>
	);
}

/** The latest catalog copy of `item`, so an open install dialog always reviews current content. */
function currentCatalogItem(
	item: MarketplaceItem,
	items: readonly MarketplaceItem[],
): MarketplaceItem {
	return items.find((entry) => entry.type === item.type && entry.id === item.id) ?? item;
}

function isSecretParameter(key: string): boolean {
	return /key|token|password|secret/i.test(key);
}

function mcpMethods(item: MarketplaceItem): McpMethod[] {
	if (item.type !== "mcp" || typeof item.content === "string") return [];
	return item.content;
}

function mcpParameters(item: MarketplaceItem, method: string | undefined): McpParameter[] {
	if (item.type !== "mcp") return [];
	const selected = mcpMethods(item).find((entry) => entry.name === method);
	const parameters = new Map(
		(item.parameters ?? []).map((parameter) => [parameter.key, parameter]),
	);
	for (const parameter of selected?.parameters ?? []) parameters.set(parameter.key, parameter);
	return [...parameters.values()];
}

function InstallDialog({
	item,
	installed,
	targets,
	defaultWorkspaceId,
	onInstalled,
	onClose,
}: InstallDialogProps) {
	const track = useTrack();
	const queryClient = useQueryClient();
	const install = useMarketplaceMutation("install", { invalidates: ["list"] });
	const methods = mcpMethods(item);
	const globalInstalled = installed.some((entry) => entry.scope === "global");
	const installedIds = installedWorkspaceIds(installed);
	const availableTargets = uninstalledTargets(installed, targets).toSorted((left, right) => {
		if (left.id === defaultWorkspaceId) return -1;
		if (right.id === defaultWorkspaceId) return 1;
		return 0;
	});
	const [globalSelected, setGlobalSelected] = useState(!globalInstalled);
	const [workspaceIds, setWorkspaceIds] = useState<string[]>(() =>
		globalInstalled && availableTargets[0] ? [availableTargets[0].id] : [],
	);
	const [destinationOpen, setDestinationOpen] = useState(false);
	const [method, setMethod] = useState<string | undefined>(methods[0]?.name);
	const [parameters, setParameters] = useState<Record<string, string>>({});
	const [submitting, setSubmitting] = useState(false);
	const [outcome, setOutcome] = useState<InstallOutcome | null>(null);
	const required = mcpParameters(item, method);
	const parametersValid = required.every(
		(parameter) => parameter.optional || Boolean(parameters[parameter.key]?.trim()),
	);
	const selectedTargets = workspaceIds.flatMap((workspaceId) => {
		const target = availableTargets.find((entry) => entry.id === workspaceId);
		return target ? [target] : [];
	});
	const destinationValid = globalSelected ? !globalInstalled : selectedTargets.length > 0;
	const valid = parametersValid && destinationValid;
	const confirmLabel = globalSelected
		? "Install in All workspaces"
		: selectedTargets.length === 1
			? `Install in ${selectedTargets[0]?.name}`
			: selectedTargets.length > 1
				? `Install in ${selectedTargets.length} workspaces`
				: "Select a location";
	const destinationLabel = globalSelected
		? "All workspaces"
		: selectedTargets.length === 1
			? selectedTargets[0]!.name
			: selectedTargets.length > 1
				? `${selectedTargets.length} workspaces`
				: "Select a location";
	const availableIds = new Set(availableTargets.map((target) => target.id));
	const validWorkspaceIds = workspaceIds.filter((id) => availableIds.has(id));
	if (globalSelected && globalInstalled) {
		setGlobalSelected(false);
		setWorkspaceIds(
			validWorkspaceIds.length > 0
				? validWorkspaceIds
				: availableTargets[0]
					? [availableTargets[0].id]
					: [],
		);
	} else if (validWorkspaceIds.length !== workspaceIds.length) {
		setWorkspaceIds(validWorkspaceIds);
	}
	const prerequisites =
		method && item.type === "mcp"
			? (methods.find((entry) => entry.name === method)?.prerequisites ?? item.prerequisites)
			: item.prerequisites;
	const selectedContent = item.type === "mcp" ? mcpInstallContent(item, method) : undefined;
	const configPreview =
		selectedContent === undefined
			? undefined
			: mcpConfigPreview(
					selectedContent,
					parameters,
					new Set(Object.keys(parameters).filter(isSecretParameter)),
				);
	const missingLaunchCommand = useMissingCommand(
		selectedContent ? mcpLaunchCommand(selectedContent) : undefined,
	);
	const close = () => {
		if (submitting) return;
		onClose();
	};
	const submit = () => {
		if (!valid) return;
		const baseInput = {
			item: { type: item.type, id: item.id },
			...(method ? { method } : {}),
			...(Object.keys(parameters).length > 0 ? { parameters } : {}),
			...(selectedContent === undefined ? {} : { reviewedContent: selectedContent }),
		};
		const destinations: InstallDestination[] = globalSelected
			? [{ label: "All workspaces", input: { ...baseInput, scope: "global" } }]
			: selectedTargets.map((target) => ({
					label: target.name,
					input: { ...baseInput, scope: "workspace", workspaceId: target.id },
				}));
		setSubmitting(true);
		setOutcome(null);
		track(MARKETPLACE_TELEMETRY_EVENTS.installClicked, itemTelemetryData(item));
		void (async () => {
			// Sequential so concurrent writes never race on shared Kilo config; every destination is
			// still attempted so one failure doesn't silently skip the rest.
			const failed: InstallFailure[] = [];
			const succeeded: string[] = [];
			for (const destination of destinations) {
				try {
					// Sequential on purpose: parallel installs would race on shared Kilo config.
					// react-doctor-disable-next-line react-doctor/async-await-in-loop
					await install.mutateAsync(destination.input);
					track(
						MARKETPLACE_TELEMETRY_EVENTS.itemInstalled,
						itemTelemetryData(item, destination.input.scope),
					);
					succeeded.push(destination.label);
				} catch (error) {
					failed.push({
						...destination,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}
			setSubmitting(false);
			if (failed.length === 0) {
				onInstalled();
				onClose();
				return;
			}
			// A failure may mean the catalog changed since review; refetching re-renders the dialog with
			// the current configuration so a retry confirms what is actually installed. Successful
			// workspaces are pruned by the availability effect once the list refreshes; narrowing
			// explicitly keeps the retry selection correct even before that lands.
			void queryClient.invalidateQueries({ queryKey: marketplaceQueryKey("list") });
			setWorkspaceIds(
				failed.flatMap(({ input }) => (input.workspaceId ? [input.workspaceId] : [])),
			);
			setOutcome({ failed, succeeded });
		})();
	};
	const selectedWorkspaceIds = new Set(workspaceIds);
	const toggleWorkspace = (workspaceId: string) => {
		setGlobalSelected(false);
		setWorkspaceIds((current) =>
			current.includes(workspaceId)
				? current.filter((id) => id !== workspaceId)
				: [...current, workspaceId],
		);
	};

	return (
		<Dialog open onOpenChange={(open) => !open && close()}>
			<DialogContent
				className="max-h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-md"
				data-qa-id="marketplace-install-dialog"
			>
				<DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left">
					<DialogTitle className="truncate" data-qa-id="marketplace-install-title">
						Install {item.name}
					</DialogTitle>
				</DialogHeader>

				<FieldGroup
					className="scroll-fade-y min-h-0 overflow-y-auto overscroll-contain px-4 py-4"
					data-qa-id="marketplace-install-content"
				>
					<Field>
						<FieldLabel>Install in</FieldLabel>
						<Popover open={destinationOpen} onOpenChange={setDestinationOpen}>
							<PopoverTrigger
								render={
									<Button
										type="button"
										variant="outline"
										className="w-full justify-between font-normal"
										data-qa-id="marketplace-install-target"
									/>
								}
							>
								<span className="flex min-w-0 items-center gap-2">
									{globalSelected ? (
										<EarthIcon data-icon="inline-start" aria-hidden />
									) : (
										<FolderIcon data-icon="inline-start" aria-hidden />
									)}
									<span className="truncate">{destinationLabel}</span>
								</span>
								<ChevronsUpDownIcon data-icon="inline-end" className="opacity-60" aria-hidden />
							</PopoverTrigger>
							<PopoverContent align="start" className="w-(--anchor-width) gap-0 p-0">
								<Command>
									<CommandInput
										placeholder="Search workspaces"
										data-qa-id="marketplace-install-workspace-search"
									/>
									<CommandList className="scroll-fade-y">
										<CommandEmpty>No workspaces found.</CommandEmpty>
										<CommandGroup>
											<CommandItem
												value="All workspaces"
												disabled={globalInstalled}
												data-checked={globalSelected}
												onSelect={() => {
													setGlobalSelected(true);
													setWorkspaceIds([]);
													setDestinationOpen(false);
												}}
												data-qa-id="marketplace-install-scope-global"
											>
												<EarthIcon aria-hidden />
												<span className="min-w-0 flex-1">All workspaces</span>
												{globalInstalled ? (
													<span className="text-muted-foreground text-xs">Already installed</span>
												) : null}
											</CommandItem>
											{targets.map((target) => {
												const installedHere = installedIds.has(target.id);
												return (
													<CommandItem
														key={target.id}
														value={`${target.name} ${target.directory}`}
														disabled={installedHere}
														data-checked={selectedWorkspaceIds.has(target.id)}
														onSelect={() => toggleWorkspace(target.id)}
														data-qa-id={`marketplace-install-workspace-option-${target.id}`}
													>
														<FolderIcon
															className={cn(!target.color && "text-muted-foreground")}
															{...(target.color ? { color: target.color } : {})}
															aria-hidden
															data-qa-id={`marketplace-install-workspace-icon-${target.id}`}
														/>
														<span className="min-w-0 flex-1 truncate">{target.name}</span>
														{installedHere ? (
															<span className="text-muted-foreground text-xs">Installed</span>
														) : null}
													</CommandItem>
												);
											})}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</Field>

					{missingLaunchCommand ? (
						<MissingCommandAlert missing={missingLaunchCommand} onFixInChat={close} />
					) : null}

					{methods.length > 1 ? (
						<Field>
							<FieldLabel htmlFor="marketplace-install-method">Install method</FieldLabel>
							<Select
								items={methods.map((entry) => ({
									label: entry.name,
									value: entry.name,
								}))}
								value={method}
								onValueChange={(value) => {
									setMethod(value ?? undefined);
									setParameters({});
								}}
							>
								<SelectTrigger
									id="marketplace-install-method"
									className="w-full"
									data-qa-id="marketplace-install-method"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{methods.map((entry) => (
											<SelectItem key={entry.name} value={entry.name}>
												{entry.name}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
					) : null}

					{prerequisites?.length ? (
						<Alert>
							<CircleAlertIcon aria-hidden="true" />
							<AlertTitle>Requirements</AlertTitle>
							<AlertDescription>
								<ul className="list-outside list-disc pl-3.5 marker:text-current">
									{prerequisites.map((value) => (
										<li key={value}>{value}</li>
									))}
								</ul>
							</AlertDescription>
						</Alert>
					) : null}

					{required.map((parameter) => (
						<Field key={parameter.key}>
							<FieldLabel htmlFor={`marketplace-param-${parameter.key}`}>
								{parameter.name}
								{parameter.optional ? " (optional)" : ""}
							</FieldLabel>
							<Input
								id={`marketplace-param-${parameter.key}`}
								type={isSecretParameter(parameter.key) ? "password" : "text"}
								value={parameters[parameter.key] ?? ""}
								placeholder={parameter.placeholder}
								onChange={(event) => {
									const value = event.currentTarget.value;
									setParameters((current) => ({
										...current,
										[parameter.key]: value,
									}));
								}}
								data-qa-id={`marketplace-param-${parameter.key}`}
							/>
						</Field>
					))}

					{item.type === "mcp" && !globalSelected && required.length > 0 ? (
						<Alert data-qa-id="marketplace-secret-warning">
							<CircleAlertIcon aria-hidden="true" />
							<AlertTitle>Workspace configuration may contain secrets</AlertTitle>
							<AlertDescription>
								Parameter values are written to <code>.kilo/kilo.json</code>. Keep that file out of
								version control if it contains secrets.
							</AlertDescription>
						</Alert>
					) : null}

					{configPreview ? <McpConfigReview preview={configPreview} /> : null}

					{outcome ? (
						<FieldError className="grid gap-1" data-qa-id="marketplace-install-error">
							{outcome.failed.map(({ label, input, message }) => (
								<p key={input.workspaceId ?? input.scope}>
									Could not install in {label}: {message}
								</p>
							))}
							{outcome.succeeded.length > 0 ? (
								<p className="text-muted-foreground">
									Installed in {LIST_FORMAT.format(outcome.succeeded)}.
								</p>
							) : null}
						</FieldError>
					) : null}
				</FieldGroup>

				<DialogFooter className="bg-muted/40 mx-0 mb-0 items-center px-4 py-3">
					<Button type="button" variant="outline" disabled={submitting} onClick={close}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={!valid || submitting}
						onClick={submit}
						className="min-w-0 shrink"
						data-qa-id="marketplace-install-confirm"
					>
						{submitting ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						<span className="truncate">{submitting ? "Installing…" : confirmLabel}</span>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function MarketplaceSettings() {
	const client = useMarketplace();
	const track = useTrack();
	const openExternal = useOpenExternal();
	const activeWorkspaceId = useActiveWorkspaceId();
	const [search, setSearch] = useState("");
	const [mode, setMode] = useState<MarketplaceMode>("installed");
	const [types, setTypes] = useState<Record<MarketplaceMode, ReadonlySet<MarketplaceType>>>({
		installed: new Set(),
		browse: new Set(),
	});
	const selectedTypes = types[mode];
	const toggleType = (value: MarketplaceType) => {
		setTypes((current) => ({ ...current, [mode]: toggled(current[mode], value) }));
	};
	const clearTypes = () => {
		setTypes((current) => ({ ...current, [mode]: new Set() }));
	};
	const [browseCategories, setBrowseCategories] = useState<ReadonlySet<string>>(() => new Set());
	const toggleBrowseCategory = (value: string) => {
		setBrowseCategories((current) => toggled(current, value));
	};
	const clearBrowseCategories = () => setBrowseCategories(new Set());
	const [showUser, setShowUser] = useState(true);
	const [showBuiltIn, setShowBuiltIn] = useState(false);
	const [excludedWorkspaceIds, setExcludedWorkspaceIds] = useState<Set<string>>(() => new Set());
	const [installing, setInstalling] = useState<MarketplaceItem | null>(null);
	const [removing, setRemoving] = useState<RemoveSelection | null>(null);
	const [revealKey, setRevealKey] = useState<string | null>(null);
	const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(() => new Set());
	const catalogViewportRef = useRef<HTMLElement>(null);
	const input = activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {};
	const query = useQuery({
		...marketplaceQueryOptions(client, "list", input),
		placeholderData: keepPreviousData,
	});
	const refresh = useMarketplaceMutation("refresh", { invalidates: ["list"] });
	const remove = useMarketplaceMutation("remove", { invalidates: ["list"] });
	const authenticateMcp = useMarketplaceMutation("authenticateMcp", { invalidates: ["list"] });
	const snapshot = query.data;
	const categoryOptions = [...new Set(snapshot?.items.map((item) => item.category))].toSorted();
	const typeOption =
		selectedTypes.size === 1
			? TYPE_OPTIONS.find((option) => option.value === [...selectedTypes][0])
			: undefined;
	const typeNoun = typeOption?.noun ?? "items";
	const { searching, filtered, typeCounts } = useDeferredMarketplaceRows(snapshot, search, {
		browseCategories,
		excludedWorkspaceIds,
		mode,
		showBuiltIn,
		showUser,
	});
	const visible =
		selectedTypes.size === 0
			? filtered
			: filtered.filter((row) => selectedTypes.has(row.item.type));
	const installedKeys = new Set(snapshot?.installed.map((entry) => `${entry.type}:${entry.id}`));
	if (revealKey) {
		if (visible.some((row) => row.key === revealKey)) {
			setOpenDetails((current) => new Set(current).add(revealKey));
			setRevealKey(null);
		} else if (installedKeys.has(revealKey)) {
			// The install landed but the installed filters hide it; a stale reveal would pop the
			// panel open later when the user changes filters for unrelated reasons.
			setRevealKey(null);
		}
	}
	const visibleKeys = new Set(visible.map((row) => row.key));
	if ([...openDetails].some((key) => !visibleKeys.has(key))) {
		setOpenDetails((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
	}
	const catalogOpen = mode === "browse";
	useEffect(() => {
		if (!catalogOpen) return;
		track(MARKETPLACE_TELEMETRY_EVENTS.tabViewed);
	}, [catalogOpen, track]);
	const installedSections = TYPE_OPTIONS.map((option) => ({
		...option,
		rows: visible.filter((row) => row.item.type === option.value),
	}));
	const catalogSections = catalogSectionsOf(visible);
	const installedFiltersCustomized =
		mode === "installed" && (!showUser || showBuiltIn || excludedWorkspaceIds.size > 0);
	const hasFilters =
		searching ||
		selectedTypes.size > 0 ||
		(mode === "browse" && browseCategories.size > 0) ||
		installedFiltersCustomized;
	const emptyTitle = hasFilters
		? mode === "installed"
			? "No matching installed items"
			: "No matching Marketplace items"
		: mode === "installed"
			? `No ${typeNoun} installed`
			: `No ${typeNoun} available`;
	const emptyDescription = hasFilters
		? "Try a different search or clear the current filters."
		: mode === "installed"
			? `Browse the Marketplace to add ${typeNoun}.`
			: "Refresh the catalog to check for newly available items.";
	const resetInstalledFilters = () => {
		setShowUser(true);
		setShowBuiltIn(false);
		setExcludedWorkspaceIds(new Set());
	};
	const clearFilters = () => {
		setSearch("");
		clearTypes();
		if (mode === "installed") resetInstalledFilters();
		else clearBrowseCategories();
	};
	const selectMode = (next: MarketplaceMode) => {
		if (next === "browse") setOpenDetails(new Set());
		setMode(next);
	};

	const confirmRemove = () => {
		if (!removing) return;
		remove.mutate(
			{
				item: { type: removing.item.type, id: removing.item.id },
				scope: removing.installed.scope,
				...(removing.installed.workspaceId ? { workspaceId: removing.installed.workspaceId } : {}),
			},
			{
				onSuccess: () => {
					track(
						MARKETPLACE_TELEMETRY_EVENTS.itemRemoved,
						itemTelemetryData(removing.item, removing.installed.scope),
					);
					setRemoving(null);
				},
			},
		);
	};

	return (
		<div className="@container flex min-w-0 flex-col gap-6" data-qa-id="marketplace-page">
			<SettingsPageHeader
				actions={
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={refresh.isPending || query.isPending}
							onClick={() => refresh.mutate(input)}
							data-qa-id="marketplace-refresh"
						>
							<RefreshCwIcon
								data-icon="inline-start"
								className={refresh.isPending ? "animate-spin" : undefined}
							/>
							Refresh
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={() => selectMode("browse")}
							data-qa-id="marketplace-add"
						>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							Add
						</Button>
					</>
				}
			/>

			{snapshot?.errors.length ? (
				<Alert data-qa-id="marketplace-warning">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>
						{snapshot.stale ? "Using saved catalog" : "Catalog partially available"}
					</AlertTitle>
					<AlertDescription>
						{snapshot.stale
							? "Showing the last saved Marketplace catalog because Kilo Marketplace is unavailable."
							: "Some Marketplace items could not be loaded."}
					</AlertDescription>
				</Alert>
			) : null}
			{refresh.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>Could not refresh Marketplace</AlertTitle>
					<AlertDescription>{refresh.error.message}</AlertDescription>
				</Alert>
			) : null}
			{authenticateMcp.error ? (
				<Alert variant="destructive" data-qa-id="marketplace-authenticate-error">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>MCP sign-in failed</AlertTitle>
					<AlertDescription>{authenticateMcp.error.message}</AlertDescription>
				</Alert>
			) : null}

			{!catalogOpen ? (
				<>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<InputGroup size="sm" className="min-w-40 flex-1">
							<InputGroupInput
								type="search"
								value={search}
								onChange={(event) => setSearch(event.currentTarget.value)}
								placeholder="Search installed items"
								aria-label="Search installed items"
								data-qa-id="marketplace-search"
							/>
							<InputGroupAddon>
								<SearchIcon aria-hidden="true" />
							</InputGroupAddon>
						</InputGroup>
						<div className="ml-auto flex max-w-full items-center gap-2">
							<TypeToggles
								selected={selectedTypes}
								total={filtered.length}
								counts={typeCounts}
								loading={query.isPending}
								onToggle={toggleType}
								onClear={clearTypes}
							/>
							<InstalledFilterMenu
								showUser={showUser}
								showBuiltIn={showBuiltIn}
								targets={snapshot?.targets ?? []}
								excludedWorkspaceIds={excludedWorkspaceIds}
								onShowUserChange={setShowUser}
								onShowBuiltInChange={setShowBuiltIn}
								onWorkspaceChange={(workspaceId, checked) => {
									setExcludedWorkspaceIds((current) => toggled(current, workspaceId, !checked));
								}}
								onReset={resetInstalledFilters}
							/>
						</div>
					</div>

					<section className="flex min-w-0 flex-col gap-2" aria-label="Installed items">
						{query.isPending ? (
							<MarketplaceLoading mode="installed" />
						) : query.error ? (
							<MarketplaceLoadError
								message={query.error.message}
								onRetry={() => void query.refetch()}
							/>
						) : visible.length > 0 ? (
							<div
								className="grid min-w-0 content-start gap-6"
								data-qa-id="marketplace-installed-list"
							>
								{installedSections.map((section) =>
									section.rows.length === 0 ? null : (
										<FieldSet
											key={section.value}
											className="min-w-0"
											aria-labelledby={`marketplace-installed-heading-${section.value}`}
										>
											<div>
												<FieldLegend
													id={`marketplace-installed-heading-${section.value}`}
													variant="label"
													className="mb-0"
												>
													{section.label}
												</FieldLegend>
											</div>
											<div className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
												{section.rows.map(({ item, installations, key }) => (
													<InstalledCard
														key={key}
														item={item}
														installations={installations}
														targets={snapshot?.targets ?? []}
														detailsOpen={openDetails.has(key)}
														mcpInstallationStatuses={snapshot?.mcpInstallationStatuses ?? {}}
														selectedMcpStatus={
															item.type === "mcp" ? snapshot?.mcpStatuses[item.id] : undefined
														}
														selectedWorkspaceId={activeWorkspaceId}
														authenticatingWorkspaceId={
															authenticateMcp.isPending && authenticateMcp.variables?.id === item.id
																? (authenticateMcp.variables.workspaceId ?? null)
																: undefined
														}
														onToggleDetails={() =>
															setOpenDetails((current) => toggled(current, key))
														}
														onAddLocation={setInstalling}
														onAuthenticate={(id, workspaceId) =>
															authenticateMcp.mutate({
																id,
																...(workspaceId ? { workspaceId } : {}),
															})
														}
														onRemove={(selected, entry) =>
															setRemoving({ item: selected, installed: entry })
														}
														onOpenLink={openExternal}
													/>
												))}
											</div>
										</FieldSet>
									),
								)}
							</div>
						) : (
							<Empty className="border" data-qa-id="marketplace-empty">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										{hasFilters ? (
											<SearchXIcon aria-hidden="true" />
										) : (
											<LibraryIcon aria-hidden="true" />
										)}
									</EmptyMedia>
									<EmptyTitle data-qa-id="marketplace-empty-title">{emptyTitle}</EmptyTitle>
									<EmptyDescription>{emptyDescription}</EmptyDescription>
								</EmptyHeader>
								{hasFilters ? (
									<EmptyContent>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={clearFilters}
											data-qa-id="marketplace-clear-filters"
										>
											Clear filters
										</Button>
									</EmptyContent>
								) : (
									<EmptyContent>
										<Button
											type="button"
											variant="secondary"
											size="sm"
											onClick={() => selectMode("browse")}
											data-qa-id="marketplace-browse-empty"
										>
											Browse Marketplace
										</Button>
									</EmptyContent>
								)}
							</Empty>
						)}
					</section>
				</>
			) : null}

			<Dialog open={catalogOpen} onOpenChange={(open) => selectMode(open ? "browse" : "installed")}>
				<DialogContent
					className="@container h-[min(48rem,calc(100dvh-4rem))] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:w-[calc(100%-4rem)] sm:max-w-6xl"
					data-qa-id="marketplace-catalog-dialog"
				>
					<DialogHeader className="shrink-0 px-4 pt-4 pr-12 pb-6 text-left">
						<DialogTitle>Kilo Marketplace</DialogTitle>
						<DialogDescription className="text-sm leading-tight">
							Browse specialized agents, skills, and MCPs to add to Kilo.
						</DialogDescription>
					</DialogHeader>
					<div className="grid w-full min-w-0 gap-4 px-4">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<InputGroup size="sm" className="min-w-40 flex-1">
								<InputGroupInput
									type="search"
									value={search}
									onChange={(event) => setSearch(event.currentTarget.value)}
									placeholder="Search Kilo Marketplace"
									aria-label="Search Kilo Marketplace"
									data-qa-id="marketplace-search"
								/>
								<InputGroupAddon>
									<SearchIcon aria-hidden="true" />
								</InputGroupAddon>
							</InputGroup>
							<TypeToggles
								selected={selectedTypes}
								total={filtered.length}
								counts={typeCounts}
								loading={query.isPending}
								onToggle={toggleType}
								onClear={clearTypes}
							/>
						</div>
						<CategoryToggles
							categories={categoryOptions}
							selected={browseCategories}
							loading={query.isPending}
							onToggle={toggleBrowseCategory}
							onClear={clearBrowseCategories}
						/>
					</div>
					{/* pl-6 matches the category tiles' px-2 inset so section content aligns with the tile
					    icons. pt-3 is small because unpressed tiles and each section header's min-h-7
					    already add transparent space; together they give a visual 24px gap. */}
					<section
						ref={catalogViewportRef}
						className="scroll-fade-y min-h-0 min-w-0 [scrollbar-gutter:stable] overflow-y-auto pt-3 pr-4 pb-4 pl-6"
						aria-label="Marketplace items"
						data-qa-id="marketplace-scroll-viewport"
					>
						{query.isPending ? (
							<MarketplaceLoading mode="browse" />
						) : query.error ? (
							<MarketplaceLoadError message={query.error.message} />
						) : visible.length > 0 ? (
							<div className="grid min-w-0 content-start gap-6" data-qa-id="marketplace-card-grid">
								{catalogSections.map((section) => {
									const previewRows =
										browseCategories.size === 0
											? section.rows.slice(0, CATEGORY_PREVIEW_LIMIT)
											: section.rows;
									return (
										<section
											key={section.value}
											className="grid min-w-0 gap-3"
											aria-labelledby={`marketplace-category-heading-${section.value}`}
											data-qa-id={`marketplace-category-section-${section.value}`}
										>
											{/* min-h-7 reserves the View all button's height so headers don't shift when it hides. */}
											<header className="flex min-h-7 min-w-0 items-center gap-2">
												<span className="text-muted-foreground shrink-0 [&>svg]:size-3.5">
													<CategoryIcon category={section.value} />
												</span>
												<h2
													id={`marketplace-category-heading-${section.value}`}
													className="truncate text-sm leading-tight font-medium"
												>
													{section.label}
												</h2>
												<span className="text-muted-foreground text-xs leading-tight tabular-nums">
													<span className="sr-only">Items: </span>
													{section.rows.length}
												</span>
												{previewRows.length < section.rows.length ? (
													<Button
														type="button"
														variant="ghost"
														size="sm"
														className="ml-auto h-7 px-2 text-xs"
														aria-label={`View all ${section.label}`}
														onClick={() => {
															catalogViewportRef.current?.scrollTo({ top: 0 });
															toggleBrowseCategory(section.value);
														}}
														data-qa-id={`marketplace-view-all-${section.value}`}
													>
														View all
													</Button>
												) : null}
											</header>
											<div className="grid min-w-0 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
												{previewRows.map(({ item, installations, key }) =>
													isCatalogItem(item) ? (
														<MarketplaceCatalogCard
															key={key}
															item={item}
															installations={installations}
															targets={snapshot?.targets ?? []}
															onInstall={setInstalling}
															onOpenLink={openExternal}
														/>
													) : null,
												)}
											</div>
										</section>
									);
								})}
							</div>
						) : (
							<Empty className="border" data-qa-id="marketplace-empty">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										{hasFilters ? (
											<SearchXIcon aria-hidden="true" />
										) : (
											<LibraryIcon aria-hidden="true" />
										)}
									</EmptyMedia>
									<EmptyTitle data-qa-id="marketplace-empty-title">{emptyTitle}</EmptyTitle>
									<EmptyDescription>{emptyDescription}</EmptyDescription>
								</EmptyHeader>
								{hasFilters ? (
									<EmptyContent>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={clearFilters}
											data-qa-id="marketplace-clear-filters"
										>
											Clear filters
										</Button>
									</EmptyContent>
								) : null}
							</Empty>
						)}
					</section>
				</DialogContent>
			</Dialog>

			{installing ? (
				<InstallDialog
					key={`${installing.type}:${installing.id}`}
					item={currentCatalogItem(installing, snapshot?.items ?? [])}
					installed={installedScopes(installing, snapshot?.installed ?? [])}
					targets={snapshot?.targets ?? []}
					defaultWorkspaceId={activeWorkspaceId}
					onInstalled={() => {
						setRevealKey(`${installing.type}:${installing.id}`);
						selectMode("installed");
					}}
					onClose={() => setInstalling(null)}
				/>
			) : null}

			<AlertDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open && !remove.isPending) setRemoving(null);
				}}
			>
				<AlertDialogContent data-qa-id="marketplace-remove-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {removing?.item.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							{removing?.installed.scope === "workspace"
								? "This removes the item from this workspace’s Kilo configuration."
								: "This removes the item from the shared configuration used by all Kilo clients."}
						</AlertDialogDescription>
						{remove.error ? <FieldError>{remove.error.message}</FieldError> : null}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={confirmRemove}
							data-qa-id="marketplace-remove-confirm"
						>
							{remove.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{remove.isPending ? "Removing…" : "Remove"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function MarketplaceLoadError({ message, onRetry }: { message: string; onRetry?(): void }) {
	return (
		<Empty className="border" data-qa-id="marketplace-error">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>Could not load Marketplace</EmptyTitle>
				<EmptyDescription>{message}</EmptyDescription>
			</EmptyHeader>
			{onRetry ? (
				<EmptyContent>
					<Button type="button" variant="outline" onClick={onRetry}>
						<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
						Try again
					</Button>
				</EmptyContent>
			) : null}
		</Empty>
	);
}

// Each placeholder reuses the loaded view's containers (section header, Card, SummaryCard.Row,
// FieldSet) and puts SkeletonText inside the same text styles, so nothing shifts when data lands.
const LOADING_SECTIONS = [
	{ key: "first", cards: ["a", "b", "c", "d", "e", "f"], rows: ["a", "b", "c"] },
	{ key: "second", cards: ["a", "b", "c"], rows: ["a", "b"] },
];

function MarketplaceLoading({ mode }: { mode: MarketplaceMode }) {
	return (
		<div
			className="grid min-w-0 content-start gap-6"
			role="status"
			aria-busy="true"
			aria-label={mode === "browse" ? "Loading Marketplace catalog" : "Loading installed items"}
			data-qa-id="marketplace-loading"
		>
			{LOADING_SECTIONS.map((section, index) =>
				mode === "browse" ? (
					<CatalogSectionPlaceholder
						key={section.key}
						cards={section.cards}
						viewAll={index === 0}
					/>
				) : (
					<InstalledSectionPlaceholder key={section.key} rows={section.rows} />
				),
			)}
		</div>
	);
}

function CatalogSectionPlaceholder({ cards, viewAll }: { cards: string[]; viewAll: boolean }) {
	return (
		<div aria-hidden="true" className="grid min-w-0 gap-3">
			<div className="flex min-h-7 min-w-0 items-center gap-2">
				<Skeleton className="size-3.5 shrink-0 rounded-sm" />
				<span className="text-sm leading-tight font-medium">
					<SkeletonText className="w-24" />
				</span>
				<span className="text-xs leading-tight">
					<SkeletonText className="w-3" />
				</span>
				{viewAll ? <Skeleton className="ml-auto h-7 w-16" /> : null}
			</div>
			<div className="grid min-w-0 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
				{cards.map((card) => (
					<CatalogCardPlaceholder key={card} />
				))}
			</div>
		</div>
	);
}

function CatalogCardPlaceholder() {
	return (
		<Card size="sm" className="min-w-0 gap-3 p-3">
			<div className="flex min-w-0 items-center gap-2.5">
				<Skeleton className="size-8 shrink-0" />
				<span className="min-w-0 text-sm font-medium">
					<SkeletonText className="w-28" />
				</span>
			</div>
			<p className="min-h-8 w-full text-xs leading-4">
				<SkeletonText className="w-64" />
				<br />
				<SkeletonText className="w-40" />
			</p>
			<div className="flex min-w-0 items-center gap-1.5 text-xs">
				<span className="min-w-0">
					<SkeletonText className="w-20" />
				</span>
				<Skeleton className="size-7 shrink-0" />
				<Skeleton className="h-5 w-16 rounded-4xl" />
			</div>
		</Card>
	);
}

function InstalledSectionPlaceholder({ rows }: { rows: string[] }) {
	return (
		<FieldSet aria-hidden="true" className="min-w-0">
			<div>
				<FieldLegend variant="label" className="mb-0">
					<SkeletonText className="w-16" />
				</FieldLegend>
			</div>
			<div className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
				{rows.map((row) => (
					<SummaryCard.Row key={row}>
						<SummaryCard.Icon>
							<Skeleton className="size-[18px] rounded-sm" />
						</SummaryCard.Icon>
						<SummaryCard.Content>
							<SummaryCard.Title>
								<SkeletonText className="w-36" />
							</SummaryCard.Title>
							<SummaryCard.Description>
								<SkeletonText className="w-72" />
							</SummaryCard.Description>
						</SummaryCard.Content>
						<SummaryCard.Actions className="gap-1.5">
							<Skeleton className="hidden h-5 w-28 rounded-4xl @xl:block" />
							<Skeleton className="size-7" />
						</SummaryCard.Actions>
					</SummaryCard.Row>
				))}
			</div>
		</FieldSet>
	);
}
