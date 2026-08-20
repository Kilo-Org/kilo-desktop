import { useState, type ReactNode } from "react";
import { PencilIcon, PlusIcon, UnplugIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { CustomProviderDialog } from "./CustomProviderDialog.js";
import { isCustomProviderPackage, type SanitizedProviderConfig } from "./custom-provider.js";
import { ProviderConnectDialog } from "./ProviderConnectDialog.js";
import type { ProviderRow } from "./provider-list.js";
import { useKiloProviders } from "./use-kilo-providers.js";

type DialogState =
	| null
	| { type: "connect"; provider: ProviderRow }
	| { type: "custom"; existing: ProviderRow | null };

/**
 * Settings section: connect catalog providers and manage custom blocks in
 * Desktop's app-owned kilo.jsonc. Contributed at `/settings/kilo-providers`.
 */
export function KiloProvidersSettings() {
	const sdk = useSdk("kilo-ui");
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

	if (connection.isPending || providers.isLoading) {
		return (
			<PageShell state="loading">
				<div className="flex flex-col gap-3">
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
				</div>
			</PageShell>
		);
	}

	const view = providers.view ?? { connected: [], popular: [], disabled: [] };
	const connectProvider = dialog?.type === "connect" ? dialog.provider : null;
	const customOpen = dialog?.type === "custom";
	const customExisting =
		customOpen && dialog.existing ? toExisting(dialog.existing, providers.config) : null;

	return (
		<PageShell
			state="ready"
			subtitle="API keys and custom providers used by Kilo chat."
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

			<ProviderSection
				title="Connected"
				empty="No providers connected yet."
				qa="kilo-providers-connected"
			>
				{view.connected.map((row) => (
					<ProviderCard
						key={row.id}
						row={row}
						{...(row.isKilo ? { onAccount: () => sdk.navigate("/settings/kilo-account") } : {})}
						{...(row.canDisconnect
							? {
									onDisconnect: () => {
										void (row.custom
											? providers.deleteCustom(row.id)
											: providers.disconnect(row.id));
									},
								}
							: {})}
						{...(row.custom ? { onEdit: () => setDialog({ type: "custom", existing: row }) } : {})}
						{...(row.isKilo
							? {}
							: {
									onDisable: () => {
										void providers.setDisabled({ providerID: row.id, disabled: true });
									},
								})}
					/>
				))}
			</ProviderSection>

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

			{view.disabled.length > 0 ? (
				<ProviderSection title="Disabled" qa="kilo-providers-disabled">
					{view.disabled.map((row) => (
						<ProviderCard
							key={row.id}
							row={row}
							onEnable={() => {
								void providers.setDisabled({ providerID: row.id, disabled: false });
							}}
						/>
					))}
				</ProviderSection>
			) : null}

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

function sourceLabel(row: ProviderRow): string | undefined {
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
	onDisable,
	onEnable,
	onAccount,
}: {
	row: ProviderRow;
	onConnect?: () => void;
	onDisconnect?: () => void;
	onEdit?: () => void;
	onDisable?: () => void;
	onEnable?: () => void;
	onAccount?: () => void;
}) {
	const tag = sourceLabel(row);
	return (
		<div
			className="border-border bg-card flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border p-3"
			data-qa-id={`kilo-providers-row-${row.id}`}
		>
			<ProviderIcon provider={row.id} variant="color" size={22} fallbackLabel={row.name} />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{row.name}</p>
				{tag ? <p className="text-muted-foreground truncate text-xs">{tag}</p> : null}
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
				{onAccount ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onAccount}
						data-qa-id="kilo-providers-manage-account"
					>
						Manage account
					</Button>
				) : null}
				{onConnect ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onConnect}
						data-qa-id={`kilo-providers-add-${row.id}`}
					>
						Connect
					</Button>
				) : null}
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
				{onDisconnect ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`Disconnect ${row.name}`}
						onClick={onDisconnect}
						data-qa-id={`kilo-providers-disconnect-${row.id}`}
					>
						<UnplugIcon />
					</Button>
				) : null}
				{onDisable ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onDisable}
						data-qa-id={`kilo-providers-disable-${row.id}`}
					>
						Disable
					</Button>
				) : null}
				{onEnable ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onEnable}
						data-qa-id={`kilo-providers-enable-${row.id}`}
					>
						Enable
					</Button>
				) : null}
			</div>
		</div>
	);
}
