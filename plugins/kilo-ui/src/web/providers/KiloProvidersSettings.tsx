import { useState, type ReactNode } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@anaconda-agentic-desktop/ui/components/alert-dialog";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { CustomProviderDialog } from "./CustomProviderDialog.js";
import type { SanitizedProviderConfig } from "./custom-provider.js";
import { KiloGatewayProviderCard } from "./KiloGatewayProviderCard.js";
import { ProviderConnectDialog } from "./ProviderConnectDialog.js";
import type { ProviderRow } from "./provider-list.js";
import { PROVIDER_ROW_GRID } from "./provider-row-layout.js";
import { useKiloProviders } from "./use-kilo-providers.js";

type DialogState =
	| null
	| { type: "connect"; provider: ProviderRow }
	| { type: "custom"; existing: ProviderRow | null }
	| { type: "remove"; provider: ProviderRow };

async function settle(task: () => Promise<unknown>): Promise<boolean> {
	return task().then(
		() => true,
		() => false,
	);
}

/**
 * Settings section: Kilo Gateway account plus catalog / custom providers in
 * Desktop's app-owned kilo.jsonc. Contributed at `/settings/kilo-providers`.
 */
export function KiloProvidersSettings() {
	const connection = useChatConnection();
	const providers = useKiloProviders(connection.connection);
	const [dialog, setDialog] = useState<DialogState>(null);

	if (connection.isError) {
		return (
			<PageShell state="unavailable">
				<p className="text-muted-foreground mt-1 text-sm" data-qa-id="kilo-providers-unavailable">
					Managing AI providers requires the desktop app. Run Anaconda Agentic Desktop to connect
					providers in Kilo config.
				</p>
			</PageShell>
		);
	}

	const connectProvider = dialog?.type === "connect" ? dialog.provider : null;
	const customOpen = dialog?.type === "custom";
	const removeProvider = dialog?.type === "remove" ? dialog.provider : null;
	const view = providers.view ?? { connected: [], environment: [], popular: [] };
	const connectedOthers = view.connected.filter((row) => !row.isKilo);
	const blockedIds = [...providers.ids, ...Object.keys(providers.config?.provider ?? {})];
	const customExisting =
		customOpen && dialog.existing ? toExisting(dialog.existing, providers.config) : null;
	const catalogLoading = connection.isPending || providers.isLoading;

	return (
		<PageShell
			state={catalogLoading ? "loading" : "ready"}
			subtitle="Connect AI providers for Kilo chat. Temporarily disable with the toggle without removing credentials."
			action={
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={catalogLoading || providers.pending}
					onClick={() => {
						providers.resetSave();
						setDialog({ type: "custom", existing: null });
					}}
					data-qa-id="kilo-providers-add-custom"
				>
					<PlusIcon data-icon="inline-start" />
					Custom AI Provider
				</Button>
			}
		>
			{providers.error ? (
				<p className="text-destructive text-sm" data-qa-id="kilo-providers-error" role="alert">
					{providers.error}
				</p>
			) : null}

			<KiloGatewayProviderCard />

			{providers.isError ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() => {
						void providers.reload();
					}}
					data-qa-id="kilo-providers-retry"
				>
					Try again
				</Button>
			) : catalogLoading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
				</div>
			) : (
				<>
					{connectedOthers.length > 0 ? (
						<ProviderSection title="Connected" qa="kilo-providers-connected">
							{connectedOthers.map((row) => (
								<ProviderCard
									key={row.id}
									row={row}
									pending={providers.pending}
									{...(row.canDisconnect && !row.custom
										? {
												onDisconnect: () => {
													void settle(() => providers.disconnect(row.id));
												},
											}
										: {})}
									{...(row.custom
										? { onRemove: () => setDialog({ type: "remove", provider: row }) }
										: {})}
									{...(row.custom
										? {
												onEdit: () => {
													providers.resetSave();
													setDialog({ type: "custom", existing: row });
												},
											}
										: {})}
									{...(row.canDisable
										? {
												onEnabledChange: (enabled: boolean) => {
													void settle(() =>
														providers.setDisabled({
															providerID: row.id,
															disabled: !enabled,
														}),
													);
												},
											}
										: {})}
								/>
							))}
						</ProviderSection>
					) : null}

					{view.environment.length > 0 ? (
						<ProviderSection
							title="Connected from your environment variables"
							qa="kilo-providers-environment"
						>
							{view.environment.map((row) => (
								<ProviderCard
									key={row.id}
									row={row}
									pending={providers.pending}
									{...(row.canDisable
										? {
												onEnabledChange: (enabled: boolean) => {
													void settle(() =>
														providers.setDisabled({
															providerID: row.id,
															disabled: !enabled,
														}),
													);
												},
											}
										: {})}
								/>
							))}
						</ProviderSection>
					) : null}

					<ProviderSection
						title="Popular"
						empty="All popular providers are connected."
						qa="kilo-providers-popular"
					>
						{view.popular.map((row) => (
							<ProviderCard
								key={row.id}
								row={row}
								pending={providers.pending}
								onConnect={() => {
									providers.resetConnect();
									setDialog({ type: "connect", provider: row });
								}}
							/>
						))}
					</ProviderSection>
				</>
			)}

			<ProviderConnectDialog
				key={`connect:${connectProvider?.id ?? "closed"}`}
				open={connectProvider !== null}
				providerName={connectProvider?.name ?? ""}
				pending={providers.pending}
				error={providers.connectError}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onSubmit={async (apiKey) => {
					if (!connectProvider) return;
					const connected = await settle(() =>
						providers.connect({ providerID: connectProvider.id, apiKey }),
					);
					if (connected) setDialog(null);
				}}
			/>

			<CustomProviderDialog
				key={`custom:${customOpen ? (customExisting?.providerID ?? "new") : "closed"}`}
				open={customOpen}
				existing={customExisting}
				blockedIds={blockedIds}
				pending={providers.pending}
				error={providers.saveError}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onSubmit={async (input) => {
					const saved = await settle(() => providers.saveCustom(input));
					if (saved) setDialog(null);
				}}
			/>

			<AlertDialog
				open={removeProvider !== null}
				onOpenChange={(open) => {
					if (!open && !providers.pending) setDialog(null);
				}}
			>
				<AlertDialogContent data-qa-id="kilo-providers-remove-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {removeProvider?.name ?? "provider"}?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes its endpoint, models, headers, and stored API key.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={providers.pending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={providers.pending}
							data-qa-id="kilo-providers-remove-confirm"
							onClick={() => {
								if (!removeProvider) return;
								void settle(() => providers.deleteCustom(removeProvider.id)).then((removed) => {
									if (removed) setDialog(null);
								});
							}}
						>
							{providers.pending ? "Removing…" : "Remove provider"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageShell>
	);
}

function toExisting(
	row: ProviderRow,
	config: { provider?: Record<string, unknown> } | undefined,
): {
	providerID: string;
	name: string;
	config: SanitizedProviderConfig | Record<string, unknown>;
} {
	const entry = config?.provider?.[row.id];
	return {
		providerID: row.id,
		name: row.name,
		config: (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>,
	};
}

function PageShell({
	state,
	subtitle,
	action,
	children,
}: {
	state: string;
	subtitle?: string;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			className="mx-auto w-full max-w-2xl min-w-0"
			data-qa-id="kilo-providers-page"
			data-state={state}
		>
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<h1
						className="font-heading text-xl font-semibold tracking-tight"
						data-qa-id="settings-section-heading"
					>
						AI Providers
					</h1>
					{subtitle ? <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p> : null}
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
			{children ? <div className="mt-6 flex min-w-0 flex-col gap-6">{children}</div> : null}
		</div>
	);
}

function ProviderSection({
	title,
	empty,
	qa,
	children,
}: {
	title: string;
	empty?: string;
	qa: string;
	children: ReactNode;
}) {
	const items = Array.isArray(children) ? children : children ? [children] : [];
	return (
		<section className="flex min-w-0 flex-col gap-2" data-qa-id={qa}>
			<h2 className="text-sm font-medium">{title}</h2>
			{items.length === 0 && empty ? (
				<p className="text-muted-foreground text-sm">{empty}</p>
			) : (
				<div className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-xl border">
					{children}
				</div>
			)}
		</section>
	);
}

function statusLabel(row: ProviderRow): string | undefined {
	if (row.isKilo) return undefined;
	if (row.custom) return "Custom";
	if (row.source === "env") return undefined;
	if (row.source === "api") return "API key";
	return undefined;
}

function ProviderCard({
	row,
	pending,
	onConnect,
	onDisconnect,
	onEdit,
	onRemove,
	onEnabledChange,
}: {
	row: ProviderRow;
	pending: boolean;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onEdit?: () => void;
	onRemove?: () => void;
	onEnabledChange?: (enabled: boolean) => void;
}) {
	const tag = statusLabel(row);
	return (
		<div
			className={cn(PROVIDER_ROW_GRID, "p-3", row.disabled && "opacity-70")}
			data-qa-id={`kilo-providers-row-${row.id}`}
			data-enabled={row.disabled ? "false" : "true"}
		>
			<ProviderIcon provider={row.id} variant="color" size={22} fallbackLabel={row.name} />
			<div className="min-w-0">
				<p className="truncate text-sm font-medium">{row.name}</p>
				{tag ? <p className="text-muted-foreground truncate text-xs">{tag}</p> : null}
			</div>
			<div className="flex justify-center">
				{onEdit ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`Edit ${row.name}`}
						disabled={pending}
						onClick={onEdit}
						data-qa-id={`kilo-providers-edit-${row.id}`}
					>
						<PencilIcon />
					</Button>
				) : null}
			</div>
			<div className="flex justify-center">
				{onConnect ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						onClick={onConnect}
						data-qa-id={`kilo-providers-add-${row.id}`}
					>
						Connect
					</Button>
				) : null}
				{onDisconnect ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						onClick={onDisconnect}
						data-qa-id={`kilo-providers-disconnect-${row.id}`}
					>
						Disconnect
					</Button>
				) : null}
				{onRemove ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						onClick={onRemove}
						data-qa-id={`kilo-providers-remove-${row.id}`}
					>
						Remove
					</Button>
				) : null}
			</div>
			<div className="flex justify-center">
				{onEnabledChange ? (
					<EnabledSwitch
						name={row.name}
						enabled={!row.disabled}
						pending={pending}
						qaId={`kilo-providers-enabled-${row.id}`}
						onEnabledChange={onEnabledChange}
					/>
				) : null}
			</div>
		</div>
	);
}

function EnabledSwitch({
	name,
	enabled,
	pending,
	qaId,
	onEnabledChange,
}: {
	name: string;
	enabled: boolean;
	pending: boolean;
	qaId: string;
	onEnabledChange: (enabled: boolean) => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				delay={300}
				closeDelay={400}
				render={<span className="inline-flex items-center justify-center p-1" />}
			>
				<Switch
					checked={enabled}
					disabled={pending}
					onCheckedChange={onEnabledChange}
					aria-label={`Enable/Disable ${name}`}
					data-qa-id={qaId}
				/>
			</TooltipTrigger>
			<TooltipContent side="left">Enable/Disable</TooltipContent>
		</Tooltip>
	);
}
