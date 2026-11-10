import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@kilo-desktop/ui/components/badge";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { DetailItem, DetailValue } from "./diagnostics-summary";
import { EntityLink } from "./inspector/navigation";

// Name, plugin id, then version (plugins, kernel) or kind (services). Fixed tracks
// are sized before flexible ones, so a fixed-width name would leave the id nothing
// in a narrow window: it is capped at a share of the row instead. Rows in a tab
// share their trailing controls, so their columns line up. Service progress and
// errors live in the row's details.
export const ROW_COLUMNS = "grid-cols-[minmax(0,min(16rem,45%))_minmax(0,1fr)_minmax(0,5rem)]";
/** Catalog rows lead with a qualified id, which needs more room than a name. */
export const CATALOG_COLUMNS = "grid-cols-[minmax(0,min(22rem,55%))_minmax(0,1fr)_minmax(0,5rem)]";

const GOOD = new Set(["active", "ready", "completed", "winner", "provided", "resolved", "on"]);
const BAD = new Set(["failed", "unresolved", "unimplemented"]);

export function StatusBadge({ status }: { readonly status: string }) {
	const variant = GOOD.has(status) ? "soft" : BAD.has(status) ? "destructive" : "secondary";
	return (
		<Badge variant={variant} data-qa-id="diagnostics-status">
			{status}
		</Badge>
	);
}

/** A titled panel of rows; each child sits in its own wrapper so `divide-y` draws separators. */
export function Panel({
	title,
	description,
	testId,
	children,
}: {
	readonly title?: ReactNode;
	readonly description?: string;
	readonly testId?: string;
	readonly children: ReactNode;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-2">
			{title ? <h2 className="text-sm font-medium">{title}</h2> : null}
			{description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
			<div
				className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border"
				data-qa-id={testId}
			>
				{children}
			</div>
		</section>
	);
}

/** Detail sections in one column, separated by space. */
export function Details({
	description,
	items,
	testId,
	className,
}: {
	readonly description?: string;
	readonly items: readonly DetailItem[];
	readonly testId?: string;
	readonly className?: string;
}) {
	return (
		<div
			className={cn(
				"border-border bg-background/60 flex flex-col gap-3 border-t px-3 py-3",
				className,
			)}
			data-qa-id={testId}
		>
			{description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
			<dl className="flex flex-col gap-3 text-xs">
				{items.map((item) => (
					<div key={item.label} className="flex min-w-0 flex-col gap-1">
						<dt className="text-foreground text-2xs font-semibold tracking-wide uppercase">
							{item.label}
						</dt>
						<dd className="flex min-w-0 flex-col gap-1 break-words">
							{groupValues(item.values).map((group, index) => (
								<ValueGroup key={index} values={group} />
							))}
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

const isId = (value: DetailValue) => value.code !== undefined && !value.items;

/** Consecutive plain ids form one list, one id per line; groups and text stand alone. */
function groupValues(values: readonly DetailValue[]): DetailValue[][] {
	const groups: DetailValue[][] = [];
	for (const value of values) {
		const last = groups.at(-1);
		if (isId(value) && last?.every(isId)) last.push(value);
		else groups.push([value]);
	}
	return groups;
}

function Id({ value }: { readonly value: DetailValue }) {
	const id = value.link ? (
		<EntityLink entity={value.link}>{value.code}</EntityLink>
	) : (
		<code className="text-2xs">{value.code}</code>
	);
	if (!value.note) return id;
	return (
		<span className="flex min-w-0 items-baseline gap-1.5">
			{id}
			<span className="text-muted-foreground text-2xs">{value.note}</span>
		</span>
	);
}

function ValueGroup({ values }: { readonly values: readonly DetailValue[] }) {
	const [first] = values;
	if (first?.items) {
		return (
			<div className="min-w-0" data-qa-id={`diagnostics-contribution-${first.code}`}>
				<Id value={first} />
				<ul className="text-muted-foreground flex flex-col gap-0.5 pl-3">
					{first.items.map((entry) => (
						<li key={entry}>{entry}</li>
					))}
				</ul>
			</div>
		);
	}
	if (first?.code !== undefined) {
		return (
			<div className="flex min-w-0 flex-col items-start gap-0.5">
				{values.map((value) => (
					<Id key={value.code} value={value} />
				))}
			</div>
		);
	}
	if (first?.block !== undefined) return <TypeBlock>{first.block}</TypeBlock>;
	return <span>{first?.text}</span>;
}

/** A type, signature or JSON value, preformatted. */
export function TypeBlock({ children }: { readonly children: string }) {
	return (
		<pre className="bg-muted text-2xs max-w-full overflow-x-auto rounded-md px-2 py-1.5 font-mono whitespace-pre">
			{children}
		</pre>
	);
}

function RowColumns({
	columns,
	columnsClassName,
}: {
	readonly columns: readonly [title: ReactNode, ...rest: ReactNode[]];
	readonly columnsClassName: string;
}) {
	const [title, ...rest] = columns;
	return (
		<div className={cn("grid min-w-0 flex-1 items-baseline gap-3", columnsClassName)}>
			<span className="truncate text-sm font-medium">{title}</span>
			{rest.map((column, index) => (
				<span key={index} className="text-muted-foreground truncate text-xs">
					{column}
				</span>
			))}
		</div>
	);
}

/** Fixed width so badges of any length keep what follows in a column. */
function StatusSlot({ children }: { readonly children: ReactNode }) {
	return <span className="pointer-events-none! flex w-24 justify-center">{children}</span>;
}

/**
 * A row that expands to show details. The whole row toggles it: the status
 * and chevron let clicks through to the row's trigger; only `leading` (before
 * the title) and `actions` (before the status) take their own clicks.
 */
export function ExpandableRow({
	name,
	testId,
	columns,
	columnsClassName,
	status,
	actions,
	leading,
	details,
}: {
	readonly name: string;
	readonly testId: string;
	/** The title first, then muted secondary columns. */
	readonly columns: readonly [title: ReactNode, ...rest: ReactNode[]];
	/**
	 * Fixed-width grid tracks: rows are separate elements, so columns line up
	 * only because every row uses the same left-anchored track widths.
	 */
	readonly columnsClassName: string;
	readonly status: ReactNode;
	readonly actions?: ReactNode;
	/** A control before the title, e.g. an on/off switch. */
	readonly leading?: ReactNode;
	readonly details: () => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const label = `${open ? "Hide" : "Show"} details for ${name}`;
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="min-w-0" data-qa-id={testId}>
			<SummaryCard.Row className="py-1.5">
				{/* Above the trigger's row-wide click overlay, so it takes its own clicks. */}
				{leading ? <span className="relative z-10 flex shrink-0">{leading}</span> : null}
				<SummaryCard.Trigger aria-label={label}>
					<RowColumns columns={columns} columnsClassName={columnsClassName} />
				</SummaryCard.Trigger>
				<SummaryCard.Actions className="gap-1.5">
					{actions}
					{/* Important: the actions slot re-enables pointer events on its children. */}
					<StatusSlot>{status}</StatusSlot>
					<ChevronDownIcon
						aria-hidden="true"
						data-qa-id="diagnostics-row-chevron"
						className={cn(
							"text-muted-foreground pointer-events-none! size-4 transition-transform",
							open && "rotate-180",
						)}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>{open ? details() : null}</CollapsibleContent>
		</Collapsible>
	);
}

/** A row that opens something, e.g. an entity in the inspector. */
export function NavigableRow({
	name,
	testId,
	columns,
	columnsClassName,
	status,
	onOpen,
}: {
	readonly name: string;
	readonly testId: string;
	readonly columns: readonly [title: ReactNode, ...rest: ReactNode[]];
	readonly columnsClassName: string;
	readonly status: ReactNode;
	readonly onOpen: () => void;
}) {
	return (
		<div className="min-w-0" data-qa-id={testId}>
			<SummaryCard.Row className="py-1.5">
				<SummaryCard.Button aria-label={`Open ${name}`} onClick={onOpen}>
					<RowColumns columns={columns} columnsClassName={columnsClassName} />
				</SummaryCard.Button>
				<SummaryCard.Actions className="gap-1.5">
					<StatusSlot>{status}</StatusSlot>
					<ChevronRightIcon
						aria-hidden="true"
						className="text-muted-foreground pointer-events-none! size-4"
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</div>
	);
}

/** Holds a plugin switch's place in a row without one, so the rows' columns line up. */
export function SwitchSpacer() {
	return (
		<span aria-hidden="true" className="invisible flex">
			<Switch size="sm" tabIndex={-1} />
		</span>
	);
}

/** The head of an inspector detail: what it is, and its state. */
export function DetailHeader({
	title,
	subtitle,
	status,
}: {
	readonly title: ReactNode;
	readonly subtitle?: ReactNode;
	readonly status?: ReactNode;
}) {
	return (
		<SummaryCard.Row>
			<SummaryCard.Content>
				<SummaryCard.Title className="min-w-0 break-all">{title}</SummaryCard.Title>
				{subtitle ? <SummaryCard.Description>{subtitle}</SummaryCard.Description> : null}
			</SummaryCard.Content>
			{status ? <SummaryCard.Actions>{status}</SummaryCard.Actions> : null}
		</SummaryCard.Row>
	);
}

/** JSON for display; values JSON can't hold (functions, cycles) are described instead. */
export function toDisplayJson(value: unknown): string {
	try {
		return (
			JSON.stringify(
				value,
				(_key, entry: unknown) =>
					typeof entry === "function"
						? "[function]"
						: typeof entry === "bigint"
							? `${entry}n`
							: entry,
				2,
			) ?? "undefined"
		);
	} catch {
		return "[not serializable]";
	}
}
