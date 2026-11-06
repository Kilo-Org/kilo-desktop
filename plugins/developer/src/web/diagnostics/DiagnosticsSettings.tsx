import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { BlocksIcon, BoxIcon, CogIcon, PuzzleIcon } from "lucide-react";

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
import { Button } from "@kilo-desktop/ui/components/button";
import { PaneTabsList, PaneTabsTrigger } from "@kilo-desktop/ui/components/pane-tabs";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { Tabs, TabsContent } from "@kilo-desktop/ui/components/tabs";

import { DEVELOPER_PLUGIN_ID } from "../../contracts";
import {
	serviceKindLabel,
	summarizeKernel,
	summarizePlugin,
	summarizeService,
	type IssueRecord,
} from "./diagnostics-summary";
import { DomainsCatalog, PointsCatalog } from "./catalogs";
import { ownerRef, type EntityRef } from "./domain-model";
import { Inspector } from "./inspector/Inspector";
import { NavigationProvider, TrailScope } from "./inspector/navigation";
import { Details, ExpandableRow, Panel, ROW_COLUMNS, StatusBadge, SwitchSpacer } from "./parts";

const PLUGIN_COLUMNS = ROW_COLUMNS;
const SERVICE_COLUMNS = ROW_COLUMNS;

const PLATFORM_NAMES = { mac: "macOS", windows: "Windows", linux: "Linux" } as const;

const selectApp = (state: DomainState<typeof KernelApp>) => state;
const selectPlugins = (state: DomainState<typeof KernelPlugins>) => state;
const selectServices = (state: DomainState<typeof KernelServices>) => state.services;

type PluginRecord = DomainState<typeof KernelPlugins>["plugins"][string];

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
					<TrailScope trail={[ownerRef(id)]}>
						<Details
							{...(summary.description ? { description: summary.description } : {})}
							items={summary.items}
							testId={`diagnostics-plugin-details-${id}`}
						/>
					</TrailScope>
				);
			}}
		/>
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

/**
 * What's running: the kernel, plugins and services, and any problems they
 * reported, plus the domain model (extension points, domain objects) to drill
 * into. The overview stays mounted, hidden, while the inspector shows an
 * entity, so coming back finds its tab, filters and expanded rows as left.
 */
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
	const [trail, setTrail] = useState<readonly EntityRef[]>([]);
	const go = useCallback((next: readonly EntityRef[]) => setTrail(next), []);
	const inspecting = trail.length > 0;

	return (
		<NavigationProvider go={go}>
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
				{inspecting ? <Inspector trail={trail} issues={issues} turnedOff={disabled} /> : null}
				<div className="flex min-w-0 flex-col gap-6" hidden={inspecting}>
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
									<TrailScope trail={[ownerRef(KERNEL_OWNER)]}>
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
									</TrailScope>
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
						<PaneTabsList aria-label="Diagnostics" className="w-full">
							<PaneTabsTrigger value="plugins" data-qa-id="diagnostics-tab-plugins">
								<PuzzleIcon aria-hidden />
								Plugins
							</PaneTabsTrigger>
							<PaneTabsTrigger value="points" data-qa-id="diagnostics-tab-points">
								<BlocksIcon aria-hidden />
								Extension points
							</PaneTabsTrigger>
							<PaneTabsTrigger value="domains" data-qa-id="diagnostics-tab-domains">
								<BoxIcon aria-hidden />
								Domain objects
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
						<TabsContent value="points">
							<PointsCatalog />
						</TabsContent>
						<TabsContent value="domains">
							<DomainsCatalog />
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
			</div>
		</NavigationProvider>
	);
}
