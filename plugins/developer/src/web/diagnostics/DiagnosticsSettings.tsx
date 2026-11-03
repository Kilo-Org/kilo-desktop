import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDownIcon, CogIcon, PuzzleIcon } from "lucide-react";

import {
	KERNEL_OWNER,
	KernelApp,
	KernelPlugins,
	KernelServices,
	KernelShell,
	ownerOf,
	type DomainState,
	type QualifiedId,
	type ServiceRecord,
} from "@kilo-desktop/kernel";
import { useDomain, useDomainState, useKernel } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { PaneTabsList, PaneTabsTrigger } from "@kilo-desktop/ui/components/pane-tabs";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { Tabs, TabsContent } from "@kilo-desktop/ui/components/tabs";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { DEVELOPER_PLUGIN_ID } from "../../contracts";
import {
	serviceKindLabel,
	summarizeKernel,
	summarizePlugin,
	summarizeService,
	type DetailItem,
	type DetailValue,
	type IssueRecord,
} from "./diagnostics-summary";

const PLATFORM_NAMES = { mac: "macOS", windows: "Windows", linux: "Linux" } as const;

// Name, plugin id, then version (plugins, kernel) or kind (services). Fixed tracks
// are sized before flexible ones, so a fixed-width name would leave the id nothing
// in a narrow window: it is capped at a share of the row instead. Rows in a tab
// share their trailing controls, so their columns line up. Service progress and
// errors live in the row's details.
const ROW_COLUMNS = "grid-cols-[minmax(0,min(16rem,45%))_minmax(0,1fr)_minmax(0,5rem)]";
const PLUGIN_COLUMNS = ROW_COLUMNS;
const SERVICE_COLUMNS = ROW_COLUMNS;

const selectApp = (state: DomainState<typeof KernelApp>) => state;
const selectPlugins = (state: DomainState<typeof KernelPlugins>) => state;
const selectServices = (state: DomainState<typeof KernelServices>) => state.services;

type PluginRecord = DomainState<typeof KernelPlugins>["plugins"][string];

function StatusBadge({ status }: { readonly status: string }) {
	const variant =
		status === "active" || status === "ready" || status === "completed"
			? "soft"
			: status === "failed" || status === "unresolved"
				? "destructive"
				: "secondary";
	return <Badge variant={variant}>{status}</Badge>;
}

/** A titled panel of rows; each child sits in its own wrapper so `divide-y` draws separators. */
function Panel({
	title,
	testId,
	children,
}: {
	readonly title?: string;
	readonly testId?: string;
	readonly children: ReactNode;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-2">
			{title ? <h2 className="text-sm font-medium">{title}</h2> : null}
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
function Details({
	description,
	items,
	testId,
}: {
	readonly description?: string;
	readonly items: readonly DetailItem[];
	readonly testId: string;
}) {
	return (
		<div
			className="border-border bg-background/60 flex flex-col gap-3 border-t px-3 py-3"
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

/** Consecutive plain ids form one list, one id per line; groups and text stand alone. */
function groupValues(values: readonly DetailValue[]): DetailValue[][] {
	const groups: DetailValue[][] = [];
	for (const value of values) {
		const last = groups.at(-1);
		const id = value.code !== undefined && !value.items;
		if (id && last?.every((entry) => entry.code !== undefined && !entry.items)) last.push(value);
		else groups.push([value]);
	}
	return groups;
}

function ValueGroup({ values }: { readonly values: readonly DetailValue[] }) {
	const [first] = values;
	if (first?.items) {
		return (
			<div className="min-w-0" data-qa-id={`diagnostics-contribution-${first.code}`}>
				<code className="text-2xs">{first.code}</code>
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
			<div className="flex min-w-0 flex-col gap-0.5">
				{values.map((value) => (
					<code key={value.code} className="text-2xs">
						{value.code}
					</code>
				))}
			</div>
		);
	}
	return <span>{first?.text}</span>;
}

/**
 * A row that expands to show details. The whole row toggles it: the status
 * and chevron let clicks through to the row's trigger; only `leading` (before
 * the title) and `actions` (before the status) take their own clicks.
 */
function ExpandableRow({
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
	const [title, ...rest] = columns;
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="min-w-0" data-qa-id={testId}>
			<SummaryCard.Row className="py-1.5">
				{/* Above the trigger's row-wide click overlay, so it takes its own clicks. */}
				{leading ? <span className="relative z-10 flex shrink-0">{leading}</span> : null}
				<SummaryCard.Trigger aria-label={label}>
					<div className={cn("grid min-w-0 flex-1 items-baseline gap-3", columnsClassName)}>
						<span className="truncate text-sm font-medium">{title}</span>
						{rest.map((column, index) => (
							<span key={index} className="text-muted-foreground truncate text-xs">
								{column}
							</span>
						))}
					</div>
				</SummaryCard.Trigger>
				<SummaryCard.Actions className="gap-1.5">
					{actions}
					{/* Important: the actions slot re-enables pointer events on its children. */}
					{/* Fixed width so badges of any length keep what follows in a column. */}
					<span className="pointer-events-none! flex w-24 justify-center">{status}</span>
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

function PluginRow({
	id,
	plugin,
	issues,
	enabled,
	locked,
	turnedOff,
}: {
	readonly id: string;
	readonly plugin: PluginRecord;
	readonly issues: readonly IssueRecord[];
	readonly turnedOff: ReadonlySet<string>;
	/** Whether the plugin runs from the next launch. */
	readonly enabled: boolean;
	/** Diagnostics needs the plugin, so it can't be turned off here. */
	readonly locked: boolean;
}) {
	const kernel = useKernel();
	const plugins = useDomain(KernelPlugins);
	return (
		<ExpandableRow
			name={id}
			testId={`diagnostics-plugin-${id}`}
			columns={[plugin.displayName, <code>{id}</code>, plugin.version]}
			columnsClassName={PLUGIN_COLUMNS}
			status={<StatusBadge status={plugin.state} />}
			leading={
				<Switch
					size="sm"
					aria-label={`Enable ${plugin.displayName}`}
					{...(locked ? { title: "Diagnostics needs this plugin" } : {})}
					data-qa-id={`diagnostics-plugin-enabled-${id}`}
					checked={enabled}
					disabled={locked || !plugins}
					onCheckedChange={(checked) =>
						void plugins?.methods.setEnabled({ pluginId: id, enabled: checked })
					}
				/>
			}
			details={() => {
				const summary = summarizePlugin(kernel, id, issues, turnedOff);
				return (
					<Details
						{...(summary.description ? { description: summary.description } : {})}
						items={summary.items}
						testId={`diagnostics-plugin-details-${id}`}
					/>
				);
			}}
		/>
	);
}

/** Holds a plugin switch's place in a row without one, so the rows' columns line up. */
function SwitchSpacer() {
	return (
		<span aria-hidden="true" className="invisible flex">
			<Switch size="sm" tabIndex={-1} />
		</span>
	);
}

/** This plugin and the owners of what it requires: turning one off would hide the way back. */
function useLockedPlugins(): ReadonlySet<string> {
	const kernel = useKernel();
	return useMemo(() => {
		const requires = Object.keys(kernel.manifest(DEVELOPER_PLUGIN_ID)?.requires ?? {});
		return new Set([DEVELOPER_PLUGIN_ID, ...requires.map((id) => ownerOf(id as QualifiedId))]);
	}, [kernel]);
}

/**
 * Turning plugins on or off applies from the next launch: turns them all on or
 * off (except the locked ones) and restarts once something changed.
 */
function PluginChanges({
	ids,
	disabled,
	locked,
	restartPending,
}: {
	readonly ids: readonly string[];
	readonly disabled: ReadonlySet<string>;
	readonly locked: ReadonlySet<string>;
	readonly restartPending: boolean;
}) {
	const app = useDomain(KernelApp);
	const plugins = useDomain(KernelPlugins);
	const unlocked = ids.filter((id) => !locked.has(id)).sort();
	const setDisabled = (pluginIds: string[]) => void plugins?.methods.setDisabled({ pluginIds });
	return (
		<Panel testId="diagnostics-plugin-changes">
			<SummaryCard.Row>
				<SummaryCard.Content>
					<SummaryCard.Title>Plugin changes apply on restart</SummaryCard.Title>
					<SummaryCard.Description>
						{restartPending
							? "Restart Kilo Desktop to start or stop the plugins you turned on or off."
							: "Plugins you turn on or off start or stop when Kilo Desktop restarts."}
					</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions className="gap-1.5">
					<Button
						variant="outline"
						size="sm"
						data-qa-id="diagnostics-enable-all"
						disabled={!plugins || disabled.size === 0}
						onClick={() => setDisabled([])}
					>
						Enable all
					</Button>
					<Button
						variant="outline"
						size="sm"
						data-qa-id="diagnostics-disable-all"
						disabled={!plugins || unlocked.every((id) => disabled.has(id))}
						onClick={() => setDisabled(unlocked)}
					>
						Disable all
					</Button>
					<Button
						size="sm"
						data-qa-id="diagnostics-restart"
						disabled={!app || !restartPending}
						onClick={() => void app?.methods.relaunch({ safeMode: false })}
					>
						Restart
					</Button>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</Panel>
	);
}

function ServiceRow({
	serviceKey,
	service,
}: {
	readonly serviceKey: string;
	readonly service: ServiceRecord;
}) {
	const kernel = useKernel();
	const services = useDomain(KernelServices);
	return (
		<ExpandableRow
			name={service.title}
			testId={`diagnostics-service-${serviceKey}`}
			columns={[service.title, <code>{service.pluginId}</code>, serviceKindLabel(service.kind)]}
			columnsClassName={SERVICE_COLUMNS}
			status={<StatusBadge status={service.status} />}
			actions={
				<Button
					variant="ghost"
					size="sm"
					onClick={() => void services?.methods.restart({ key: serviceKey })}
				>
					Restart
				</Button>
			}
			details={() => (
				<Details
					items={summarizeService(kernel, serviceKey, service)}
					testId={`diagnostics-service-details-${serviceKey}`}
				/>
			)}
		/>
	);
}

/** Entries ordered alphabetically by a display name, falling back to the key on ties. */
function sortedBy<T>(
	record: Readonly<Record<string, T>>,
	name: (value: T) => string,
): [string, T][] {
	return Object.entries(record).sort(
		([aKey, a], [bKey, b]) =>
			name(a).localeCompare(name(b), undefined, { sensitivity: "base" }) ||
			aKey.localeCompare(bKey),
	);
}

/** Main and renderer both report discovery issues; show each once. */
function uniqueIssues(issues: readonly IssueRecord[]): IssueRecord[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = `${issue.severity}|${issue.pluginId ?? ""}|${issue.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** What's running: the kernel, plugins and services, and any problems they reported. */
export function DiagnosticsSettings() {
	const kernel = useKernel();
	const app = useDomainState(KernelApp, selectApp);
	const plugins = useDomainState(KernelPlugins, selectPlugins);
	const services = useDomainState(KernelServices, selectServices) ?? {};
	const shell = useDomain(KernelShell);
	const localIssues = useSyncExternalStore(
		(onChange) => kernel.onIssuesChange(onChange),
		() => kernel.issues(),
		() => kernel.issues(),
	);
	const issues = uniqueIssues([...(plugins?.issues ?? []), ...localIssues]);
	const problems = issues.filter((issue) => issue.severity === "error");
	const locked = useLockedPlugins();
	const disabled = new Set(plugins?.disabled ?? []);
	const restartPending = Object.entries(plugins?.plugins ?? {}).some(
		([id, plugin]) => (plugin.state === "disabled") !== disabled.has(id),
	);

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="diagnostics-settings">
			<SettingsPageHeader
				actions={
					shell ? (
						<Button
							variant="outline"
							size="sm"
							data-qa-id="diagnostics-open-logs"
							onClick={() => void shell.methods.showLogs(undefined)}
						>
							Open logs
						</Button>
					) : null
				}
			/>
			{app ? (
				<Panel title="Kernel">
					<ExpandableRow
						name={KERNEL_OWNER}
						testId="diagnostics-kernel"
						columns={["Kernel", <code>{KERNEL_OWNER}</code>, app.version]}
						columnsClassName={PLUGIN_COLUMNS}
						status={<StatusBadge status={app.safeMode ? "safe mode" : app.phase} />}
						leading={<SwitchSpacer />}
						details={() => (
							<Details
								items={[
									{ label: "Platform", values: [{ text: PLATFORM_NAMES[app.platform] }] },
									...(app.safeMode
										? [{ label: "Safe mode", values: [{ text: "Plugins are turned off" }] }]
										: []),
									...summarizeKernel(kernel, issues),
								]}
								testId="diagnostics-kernel-details"
							/>
						)}
					/>
				</Panel>
			) : null}
			{problems.length > 0 ? (
				<Panel title="Problems">
					{problems.map((problem) => (
						<div key={`${problem.pluginId ?? "kernel"}:${problem.message}`}>
							<SummaryCard.Row>
								<SummaryCard.Content>
									<SummaryCard.Title>{problem.pluginId ?? "kernel"}</SummaryCard.Title>
									<SummaryCard.Description data-qa-id="diagnostics-problem">
										{problem.message}
									</SummaryCard.Description>
								</SummaryCard.Content>
							</SummaryCard.Row>
						</div>
					))}
				</Panel>
			) : null}
			{plugins ? (
				<PluginChanges
					ids={Object.keys(plugins.plugins)}
					disabled={disabled}
					locked={locked}
					restartPending={restartPending}
				/>
			) : null}
			<Tabs defaultValue="plugins" className="min-w-0 gap-3" data-qa-id="diagnostics-tabs">
				<PaneTabsList aria-label="Diagnostics">
					<PaneTabsTrigger value="plugins" data-qa-id="diagnostics-tab-plugins">
						<PuzzleIcon aria-hidden />
						Plugins
					</PaneTabsTrigger>
					<PaneTabsTrigger value="services" data-qa-id="diagnostics-tab-services">
						<CogIcon aria-hidden />
						Services
					</PaneTabsTrigger>
				</PaneTabsList>
				<TabsContent value="plugins">
					<Panel testId="diagnostics-plugins">
						{sortedBy(plugins?.plugins ?? {}, (plugin) => plugin.displayName).map(
							([id, plugin]) => (
								<PluginRow
									key={id}
									id={id}
									plugin={plugin}
									issues={issues}
									enabled={!disabled.has(id)}
									locked={locked.has(id)}
									turnedOff={disabled}
								/>
							),
						)}
					</Panel>
				</TabsContent>
				<TabsContent value="services">
					{Object.keys(services).length > 0 ? (
						<Panel testId="diagnostics-services">
							{sortedBy(services, (service) => service.title).map(([key, service]) => (
								<ServiceRow key={key} serviceKey={key} service={service} />
							))}
						</Panel>
					) : (
						<p className="text-muted-foreground text-sm" data-qa-id="diagnostics-no-services">
							No plugin runs a background service.
						</p>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}
