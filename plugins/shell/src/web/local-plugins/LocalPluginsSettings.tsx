import { useState } from "react";
import {
	FolderOpenIcon,
	InfoIcon,
	PuzzleIcon,
	RefreshCwIcon,
	TriangleAlertIcon,
} from "lucide-react";

import {
	KernelApp,
	KernelOs,
	KernelPlugins,
	type DomainObjectMethods,
	type DomainObjectState,
	type ExternalPluginRecord,
	type ExternalPluginsState,
} from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import {
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	localPluginStatus,
	type KernelPluginFacts,
	type LocalPluginStatus,
	type PluginStatusKind,
} from "./plugin-status";

const selectExternal = (state: { external: ExternalPluginsState | null }) => state.external;

const CARD_CLASS =
	"border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border";

type PluginsMethods = DomainObjectMethods<typeof KernelPlugins>;
type Run = (action: (methods: PluginsMethods) => Promise<unknown>) => Promise<void>;

/** Runs `kernel/plugins` calls, tracking whether one is in flight and the last failure. */
function usePluginsActions() {
	const plugins = useDomainObject(KernelPlugins);
	const [pending, setPending] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const run: Run = async (action) => {
		if (!plugins) return;
		setPending((count) => count + 1);
		setError(null);
		try {
			await action(plugins.methods);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
		}
		setPending((count) => count - 1);
	};
	return { busy: pending > 0, error, run };
}

/** Reveals a path in the OS file manager, toasting when the OS refuses. */
function useReveal() {
	const os = useDomainObject(KernelOs);
	const reveal = async (path: string) => {
		try {
			await os?.methods.showItemInFolder({ path });
		} catch (cause) {
			toast.error("Couldn't open the folder", {
				description: cause instanceof Error ? cause.message : path,
			});
		}
	};
	return { available: os !== undefined, reveal };
}

const STATUS_DOT_CLASS: Record<PluginStatusKind, string> = {
	active: "bg-success",
	// Blue like the restart banner: it changes when Kilo Desktop restarts.
	pending: "bg-info",
	attention: "bg-warning",
	idle: "bg-muted-foreground/35",
	problem: "bg-destructive",
};

type KernelPluginsState = DomainObjectState<typeof KernelPlugins>;
const selectKernelPlugins = (state: KernelPluginsState) => state.plugins;
const selectIssues = (state: KernelPluginsState) => state.issues;

/** The kernel's state and errors for one plugin this launch. */
function kernelFacts(
	id: string | undefined,
	plugins: KernelPluginsState["plugins"] | undefined,
	issues: KernelPluginsState["issues"] | undefined,
): KernelPluginFacts {
	if (id === undefined) return { errors: [] };
	const state = plugins?.[id]?.state;
	return {
		...(state ? { state } : {}),
		errors: (issues ?? [])
			.filter((issue) => issue.pluginId === id && issue.severity === "error")
			.map((issue) => issue.message),
	};
}

/**
 * Settings → Plugins: the user's local plugins. Approving one opens the
 * host's native confirmation, so this page never decides on its own that
 * code may run; every change applies from the next launch.
 */
export function LocalPluginsSettings() {
	const external = useDomainObjectState(KernelPlugins, selectExternal);
	const kernelPlugins = useDomainObjectState(KernelPlugins, selectKernelPlugins);
	const issues = useDomainObjectState(KernelPlugins, selectIssues);
	const app = useDomainObject(KernelApp);
	const { busy, error, run } = usePluginsActions();
	const reveal = useReveal();
	const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);

	if (external === undefined) {
		return (
			<div className="flex min-w-0 flex-col gap-6" data-qa-id="local-plugins-settings">
				<SettingsPageHeader />
				<LocalPluginsSkeleton />
			</div>
		);
	}
	if (external === null) {
		return (
			<div className="flex min-w-0 flex-col gap-6" data-qa-id="local-plugins-settings">
				<SettingsPageHeader />
				<p className="text-muted-foreground text-sm" data-qa-id="local-plugins-unavailable">
					Local plugins are available in the desktop app.
				</p>
			</div>
		);
	}

	const setEnabled = async (enabled: boolean) => {
		setPendingEnabled(enabled);
		await run((methods) => methods.setExternalEnabled({ enabled }));
		setPendingEnabled(null);
	};

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="local-plugins-settings">
			<SettingsPageHeader
				actions={
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						data-qa-id="local-plugins-refresh"
						onClick={() => void run((methods) => methods.refreshExternal(undefined))}
					>
						<RefreshCwIcon data-icon="inline-start" className={busy ? "animate-spin" : undefined} />
						Refresh
					</Button>
				}
			/>
			{/*
			 * The restart prompt takes the warning's place in one grid cell, so the
			 * slot keeps its height and the page doesn't jump when it appears. The
			 * hidden one stays laid out (invisible) to hold that height; the shorter
			 * one packs its lines at the top, so its icon and title sit exactly where
			 * the warning's do.
			 */}
			<div className="grid min-w-0 *:col-start-1 *:row-start-1">
				<Alert
					variant="warning"
					className={external.restartNeeded ? "invisible" : undefined}
					aria-hidden={external.restartNeeded}
					data-qa-id="local-plugins-warning"
				>
					<TriangleAlertIcon aria-hidden="true" />
					<AlertTitle>Only use plugins you wrote or trust</AlertTitle>
					<AlertDescription>
						Local plugins have the same access to this computer as Kilo Desktop: your files, the
						network, and the accounts you're signed in to here. A plugin is only loaded once you
						enable it below. If its files change, it's disabled from the next launch until you
						enable it again.
					</AlertDescription>
				</Alert>
				<Alert
					variant="info"
					className={cn("content-start", !external.restartNeeded && "invisible")}
					aria-hidden={!external.restartNeeded}
					data-qa-id="local-plugins-restart"
				>
					<InfoIcon aria-hidden="true" />
					<AlertTitle>Restart to apply your changes</AlertTitle>
					<AlertDescription>Plugins start and stop when Kilo Desktop opens.</AlertDescription>
					<div className="col-start-2 mt-2">
						<Button
							size="sm"
							tabIndex={external.restartNeeded ? undefined : -1}
							data-qa-id="local-plugins-restart-button"
							onClick={() => void app?.methods.relaunch({ safeMode: false })}
						>
							Restart
						</Button>
					</div>
				</Alert>
			</div>
			<section className={CARD_CLASS}>
				<div>
					<SummaryCard.Row>
						<SummaryCard.Content>
							<SummaryCard.Title>
								<label htmlFor="local-plugins-enabled">Enable local plugins</label>
							</SummaryCard.Title>
							<SummaryCard.Description className="line-clamp-none">
								Load approved plugins from the plugins folder when Kilo Desktop opens.
							</SummaryCard.Description>
						</SummaryCard.Content>
						<SummaryCard.Actions>
							<Switch
								id="local-plugins-enabled"
								data-qa-id="local-plugins-enabled"
								checked={pendingEnabled ?? external.enabled}
								disabled={pendingEnabled !== null}
								onCheckedChange={(enabled) => void setEnabled(enabled)}
							/>
						</SummaryCard.Actions>
					</SummaryCard.Row>
				</div>
				<div>
					<SummaryCard.Row>
						<SummaryCard.Content>
							<SummaryCard.Title>Plugins folder</SummaryCard.Title>
							<SummaryCard.Description className="line-clamp-none">
								<code className="text-2xs break-all" data-qa-id="local-plugins-directory">
									{external.directory}
								</code>
							</SummaryCard.Description>
						</SummaryCard.Content>
						<SummaryCard.Actions>
							<Button
								variant="outline"
								size="sm"
								disabled={!reveal.available}
								data-qa-id="local-plugins-reveal"
								onClick={() => void reveal.reveal(external.directory)}
							>
								{revealInFileManagerLabel()}
							</Button>
						</SummaryCard.Actions>
					</SummaryCard.Row>
				</div>
			</section>
			{error ? (
				<FieldError className="text-sm" data-qa-id="local-plugins-error">
					{error}
				</FieldError>
			) : null}
			{external.enabled || external.plugins.length > 0 ? (
				<FieldSet
					className="min-w-0"
					aria-labelledby="local-plugins-list-heading"
					data-qa-id="local-plugins-installed"
				>
					<FieldContent>
						<FieldLegend id="local-plugins-list-heading" variant="label" className="mb-0">
							Installed
						</FieldLegend>
						<FieldDescription>
							One folder per plugin, each with its plugin.json and built JavaScript.
						</FieldDescription>
					</FieldContent>
					{external.plugins.length === 0 ? (
						<Empty className="border" data-qa-id="local-plugins-empty">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<PuzzleIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No local plugins</EmptyTitle>
								<EmptyDescription>
									Put a plugin's folder in the plugins folder, then refresh.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button
									variant="outline"
									size="sm"
									disabled={!reveal.available}
									onClick={() => void reveal.reveal(external.directory)}
								>
									<FolderOpenIcon data-icon="inline-start" />
									{revealInFileManagerLabel()}
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<ul aria-label="Local plugins" className={CARD_CLASS} data-qa-id="local-plugins-list">
							{external.plugins.map((plugin) => (
								<li key={plugin.folder} data-qa-id={`local-plugin-${plugin.folder}`}>
									<PluginRow
										plugin={plugin}
										status={localPluginStatus(
											plugin,
											kernelFacts(plugin.id, kernelPlugins, issues),
										)}
										busy={busy}
										run={run}
									/>
								</li>
							))}
						</ul>
					)}
				</FieldSet>
			) : null}
		</div>
	);
}

function PluginRow({
	plugin,
	status,
	busy,
	run,
}: {
	readonly plugin: ExternalPluginRecord;
	readonly status: LocalPluginStatus;
	readonly busy: boolean;
	readonly run: Run;
}) {
	const { id, hash } = plugin;
	const name = plugin.displayName ?? plugin.folder;
	// Approval is pinned to the scanned files, so only a valid plugin with a digest can be enabled.
	const approvable = id !== undefined && hash !== undefined && plugin.status !== "invalid";
	return (
		<SummaryCard.Row>
			<SummaryCard.Icon>
				<PuzzleIcon aria-hidden="true" />
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title className="w-full min-w-0">
					<span className="truncate">{name}</span>
					<span
						className={cn(
							"text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs font-normal",
							status.kind === "problem" && "text-destructive",
						)}
					>
						<span
							className={cn("size-2 shrink-0 rounded-full", STATUS_DOT_CLASS[status.kind])}
							data-status={status.kind}
							aria-hidden
						/>
						<span data-qa-id="local-plugin-status">{status.label}</span>
					</span>
				</SummaryCard.Title>
				{plugin.description ? (
					<SummaryCard.Description title={plugin.description}>
						{plugin.description}
					</SummaryCard.Description>
				) : null}
				{status.message ? (
					<p className="text-destructive text-2xs" data-qa-id="local-plugin-message">
						{status.message}
					</p>
				) : null}
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Switch
					aria-label={`Enable ${name}`}
					title={approvable ? `Enable ${name}` : "This plugin can't load"}
					data-qa-id="local-plugin-allowed"
					checked={plugin.approved}
					disabled={busy || !approvable}
					onCheckedChange={(allowed) => {
						if (id === undefined || hash === undefined) return;
						void run((methods) =>
							allowed
								? methods.approveExternal({ pluginId: id, hash })
								: methods.revokeExternal({ pluginId: id }),
						);
					}}
				/>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

function LocalPluginsSkeleton() {
	return (
		<section className={CARD_CLASS} role="status" aria-busy="true" aria-label="Loading plugins">
			{[0, 1].map((row) => (
				<div key={row}>
					<SummaryCard.Row>
						<SummaryCard.Content>
							<SummaryCard.Title>
								<SkeletonText className="w-40" />
							</SummaryCard.Title>
							<SummaryCard.Description>
								<SkeletonText className="w-64" />
							</SummaryCard.Description>
						</SummaryCard.Content>
						<SummaryCard.Actions>
							<Skeleton className="h-[18.4px] w-8 rounded-full" />
						</SummaryCard.Actions>
					</SummaryCard.Row>
				</div>
			))}
		</section>
	);
}
