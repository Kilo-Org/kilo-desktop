import { useState, type ReactNode } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { CustomProviderDialog } from "./CustomProviderDialog.js";
import { isCustomProviderPackage, type SanitizedProviderConfig } from "./custom-provider.js";
import { KiloGatewayProviderCard } from "./KiloGatewayProviderCard.js";
import { ProviderConnectDialog } from "./ProviderConnectDialog.js";
import type { ProviderRow } from "./provider-list.js";
import { PROVIDER_ROW_GRID } from "./provider-row-layout.js";
import { useKiloProviders } from "./use-kilo-providers.js";

type DialogState =
	| null
	| { type: "connect"; provider: ProviderRow }
	| { type: "custom"; existing: ProviderRow | null };

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
	const view = providers.view ?? { connected: [], popular: [] };
	const connectedOthers = view.connected.filter((row) => !row.isKilo);
	const customExisting =
		customOpen && dialog.existing ? toExisting(dialog.existing, providers.config) : null;
	const catalogLoading = connection.isPending || providers.isLoading;

	return (
		<PageShell
			state={catalogLoading ? "loading" : "ready"}
			subtitle="Connect providers for Kilo chat. Toggle off to hide from the model selector without removing credentials."
			action={
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setDialog({ type: "custom", existing: null })}
					data-qa-id="kilo-providers-add-custom"
				>
					<PlusIcon data-icon="inline-start" />
					Add custom provider
				</Button>
			}
		>
			{providers.error ? (
				<p className="text-destructive text-sm" data-qa-id="kilo-providers-error" role="alert">
					{providers.error}
				</p>
			) : null}

			<KiloGatewayProviderCard />

			{catalogLoading ? (
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
									{...(row.canDisconnect
										? {
												onDisconnect: () => {
													void (row.custom
														? providers.deleteCustom(row.id)
														: providers.disconnect(row.id));
												},
											}
										: {})}
									{...(row.custom
										? { onEdit: () => setDialog({ type: "custom", existing: row }) }
										: {})}
									{...(row.canDisable
										? {
												onEnabledChange: (enabled: boolean) => {
													void providers.setDisabled({
														providerID: row.id,
														disabled: !enabled,
													});
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
								onConnect={() => setDialog({ type: "connect", provider: row })}
							/>
						))}
					</ProviderSection>
				</>
			)}

			<ProviderConnectDialog
				open={connectProvider !== null}
				providerName={connectProvider?.name ?? ""}
				pending={providers.pending}
				error={providers.error}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onSubmit={async (apiKey) => {
					if (!connectProvider) return;
					await providers.connect({ providerID: connectProvider.id, apiKey });
					setDialog(null);
				}}
			/>

			<CustomProviderDialog
				open={customOpen}
				existing={customExisting}
				pending={providers.pending}
				error={providers.error}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onSubmit={async (input) => {
					await providers.saveCustom(input);
					setDialog(null);
				}}
			/>
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
	hasApiKey: boolean;
} {
	const entry = config?.provider?.[row.id];
	return {
		providerID: row.id,
		name: row.name,
		config: (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>,
		hasApiKey:
			row.connected && isCustomProviderPackage((entry as { npm?: unknown } | undefined)?.npm),
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
						Providers
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
				<div className="flex min-w-0 flex-col gap-2">{children}</div>
			)}
		</section>
	);
}

function statusLabel(row: ProviderRow): string | undefined {
	if (row.isKilo) return undefined;
	if (row.custom) return "Custom";
	if (row.source === "env") return "Environment";
	if (row.source === "api") return "API key";
	return undefined;
}

function ProviderCard({
	row,
	onConnect,
	onDisconnect,
	onEdit,
	onEnabledChange,
}: {
	row: ProviderRow;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onEdit?: () => void;
	onEnabledChange?: (enabled: boolean) => void;
}) {
	const tag = statusLabel(row);
	return (
		<div
			className={cn(
				PROVIDER_ROW_GRID,
				"border-border bg-card overflow-hidden rounded-xl border p-3",
				row.disabled && "opacity-70",
			)}
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
						onClick={onDisconnect}
						data-qa-id={`kilo-providers-disconnect-${row.id}`}
					>
						Disconnect
					</Button>
				) : null}
			</div>
			<div className="flex justify-center">
				{onEnabledChange ? (
					<TooltipProvider delay={300} closeDelay={1500}>
						<Tooltip>
							<TooltipTrigger
								render={
									<Switch
										checked={!row.disabled}
										onCheckedChange={onEnabledChange}
										aria-label={
											row.disabled
												? `Show ${row.name} in model selector`
												: `Hide ${row.name} from model selector`
										}
										data-qa-id={`kilo-providers-enabled-${row.id}`}
									/>
								}
							/>
							<TooltipContent>
								{row.disabled ? "Show in model selector" : "Hide from model selector"}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : null}
			</div>
		</div>
	);
}
