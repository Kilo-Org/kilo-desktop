import { Fragment, useState, type ReactNode } from "react";
import { PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react";

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
import { Badge } from "@anaconda-agentic-desktop/ui/components/badge";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";

import { useKiloAuth } from "../account/KiloAuthContext.js";
import { KiloGatewayAccountLoadingState } from "../account/KiloGatewayAccountPanel.js";
import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { AddProviderDialog } from "./AddProviderDialog.js";
import { CustomProviderDialog } from "./CustomProviderDialog.js";
import type { SanitizedProviderConfig } from "./custom-provider.js";
import { KiloGatewayProviderCard } from "./KiloGatewayProviderCard.js";
import type { ProviderRow } from "./provider-list.js";
import { useKiloProviders } from "./use-kilo-providers.js";

type DialogState =
	| null
	| { type: "add" }
	| { type: "custom"; existing: ProviderRow }
	| { type: "remove"; provider: ProviderRow };

async function settle(task: () => Promise<unknown>): Promise<boolean> {
	return task().then(
		() => true,
		() => false,
	);
}

/**
 * A focused provider switchboard for Kilo chat. Kilo Gateway is the primary
 * path; direct API keys and custom endpoints remain available without exposing
 * the underlying provider config file as product UI.
 */
export function KiloProvidersSettings() {
	const connection = useChatConnection();
	const auth = useKiloAuth();
	const providers = useKiloProviders(connection.connection);
	const [dialog, setDialog] = useState<DialogState>(null);

	if (connection.isError) {
		return (
			<PageShell state="unavailable">
				<p className="text-muted-foreground text-sm" data-qa-id="kilo-providers-unavailable">
					Provider management is available in Anaconda Agentic Desktop.
				</p>
			</PageShell>
		);
	}

	const addOpen = dialog?.type === "add";
	const customOpen = dialog?.type === "custom";
	const removeProvider = dialog?.type === "remove" ? dialog.provider : null;
	const view = providers.view ?? { connected: [], environment: [], popular: [] };
	const providerShapeKnown = providers.view !== undefined;
	const connected = [...view.connected.filter((row) => !row.isKilo), ...view.environment].toSorted(
		(left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
	);
	const blockedIds = [...providers.ids, ...Object.keys(providers.config?.provider ?? {})];
	const customExisting =
		customOpen && dialog.existing ? toExisting(dialog.existing, providers.config) : null;
	const catalogLoading = connection.isPending || providers.isLoading;
	const initialAccountLoading = auth.isLoading && auth.deviceAuth.status === "idle";
	const pageLoading = catalogLoading || initialAccountLoading;

	const openCustomProvider = (existing: ProviderRow) => {
		providers.resetSave();
		setDialog({ type: "custom", existing });
	};

	return (
		<PageShell
			state={pageLoading ? "loading" : "ready"}
			action={
				<Button
					type="button"
					size="sm"
					disabled={pageLoading || providers.isError || providers.pending}
					onClick={() => setDialog({ type: "add" })}
					data-qa-id="kilo-providers-add-provider"
				>
					<PlusIcon data-icon="inline-start" />
					Connect provider
				</Button>
			}
		>
			{pageLoading ? (
				<ProvidersContentLoadingState
					connected={connected}
					shapeKnown={providerShapeKnown}
					gatewayExpanded={auth.authenticated === true}
				/>
			) : (
				<>
					<KiloGatewayProviderCard />

					{providers.error ? (
						<div
							className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm"
							data-qa-id="kilo-providers-error"
							role="alert"
						>
							{providers.error}
						</div>
					) : null}

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
							<RotateCcwIcon data-icon="inline-start" />
							Try again
						</Button>
					) : null}

					{connected.length > 0 ? (
						<ProviderSection title="Connected providers" qa="kilo-providers-connected">
							<ItemGroup className="border-border bg-card gap-0 overflow-hidden rounded-xl border has-data-[size=sm]:gap-0">
								{connected.map((row, index) => (
									<Fragment key={row.id}>
										{index > 0 ? <ItemSeparator className="my-0" /> : null}
										<ConnectedProvider
											row={row}
											pending={providers.pending}
											{...(row.canDisconnect && !row.custom
												? { onDisconnect: () => void settle(() => providers.disconnect(row.id)) }
												: {})}
											{...(row.custom ? { onEdit: () => openCustomProvider(row) } : {})}
											{...(row.custom
												? { onRemove: () => setDialog({ type: "remove", provider: row }) }
												: {})}
										/>
									</Fragment>
								))}
							</ItemGroup>
						</ProviderSection>
					) : null}
				</>
			)}

			<AddProviderDialog
				key={`add:${addOpen ? "open" : "closed"}`}
				open={addOpen}
				providers={view.popular}
				blockedIds={blockedIds}
				pending={providers.pending}
				connectError={providers.connectError}
				saveError={providers.saveError}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onResetConnect={providers.resetConnect}
				onResetSave={providers.resetSave}
				onConnect={async (provider, apiKey) => {
					const didConnect = await settle(() =>
						providers.connect({ providerID: provider.id, apiKey }),
					);
					if (didConnect) setDialog(null);
				}}
				onSaveCustom={async (input) => {
					const didSave = await settle(() => providers.saveCustom(input));
					if (didSave) setDialog(null);
				}}
			/>

			<CustomProviderDialog
				key={`custom:${customOpen ? (customExisting?.providerID ?? "editing") : "closed"}`}
				open={customOpen}
				existing={customExisting}
				blockedIds={blockedIds}
				pending={providers.pending}
				error={providers.saveError}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onSubmit={async (input) => {
					const didSave = await settle(() => providers.saveCustom(input));
					if (didSave) setDialog(null);
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
						<AlertDialogTitle>Delete {removeProvider?.name ?? "provider"}?</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes its endpoint, models, headers, and stored API key.
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
								const providerID = removeProvider.id;
								setDialog(null);
								void settle(() => providers.deleteCustom(providerID));
							}}
						>
							{providers.pending ? "Deleting…" : "Delete provider"}
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
	action,
	children,
}: {
	state: string;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6"
			data-qa-id="kilo-providers-page"
			data-state={state}
		>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1
						className="text-xl font-semibold tracking-tight"
						data-qa-id="settings-section-heading"
					>
						AI Providers
					</h1>
					<p className="text-muted-foreground mt-1 text-sm">Choose where your models come from.</p>
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</header>
			{children}
		</div>
	);
}

function ProviderSection({
	title,
	qa,
	children,
}: {
	title: string;
	qa: string;
	children: ReactNode;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-4" data-qa-id={qa}>
			<div className="min-w-0">
				<h2 className="text-sm font-medium">{title}</h2>
			</div>
			{children}
		</section>
	);
}

function ProvidersContentLoadingState({
	connected,
	shapeKnown,
	gatewayExpanded,
}: {
	connected: ProviderRow[];
	shapeKnown: boolean;
	gatewayExpanded: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="kilo-providers-loading">
			<span className="sr-only" role="status">
				Loading providers
			</span>
			<GatewayProviderLoadingState expanded={gatewayExpanded} />
			{shapeKnown && connected.length > 0 ? (
				<ConnectedProvidersLoadingState connected={connected} />
			) : null}
		</div>
	);
}

function GatewayProviderLoadingState({ expanded }: { expanded: boolean }) {
	return (
		<section
			className="border-border bg-card min-w-0 overflow-hidden rounded-xl border"
			aria-hidden="true"
		>
			<div className="flex min-w-0 items-center gap-3 p-4">
				<Skeleton className="bg-muted-foreground/25 size-10 shrink-0 rounded-lg" />
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<Skeleton className="bg-muted-foreground/25 h-4 w-32" />
					<Skeleton className="bg-muted-foreground/25 h-3.5 w-56 max-w-full" />
				</div>
				<Skeleton className="bg-muted-foreground/25 h-7 w-20 shrink-0 rounded-lg" />
			</div>
			{expanded ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountLoadingState />
				</div>
			) : null}
		</section>
	);
}

function ConnectedProvidersLoadingState({ connected }: { connected: ProviderRow[] }) {
	return (
		<section className="flex min-w-0 flex-col gap-4" aria-hidden="true">
			<div className="min-w-0">
				<Skeleton className="bg-muted-foreground/25 flex w-fit">
					<span className="invisible text-sm font-medium">Connected providers</span>
				</Skeleton>
			</div>
			<ItemGroup className="border-border bg-card gap-0 overflow-hidden rounded-xl border has-data-[size=sm]:gap-0">
				{connected.map((row, index) => (
					<Fragment key={row.id}>
						{index > 0 ? <ItemSeparator className="my-0" /> : null}
						<ConnectedProviderLoadingState row={row} />
					</Fragment>
				))}
			</ItemGroup>
		</section>
	);
}

function ConnectedProviderLoadingState({ row }: { row: ProviderRow }) {
	return (
		<Item size="sm" className="min-w-0 flex-nowrap rounded-none border-0">
			<ItemMedia className="border-border bg-background size-8 rounded-lg border">
				<Skeleton className="bg-muted-foreground/25 size-full rounded-md" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<Skeleton className="bg-muted-foreground/25 flex min-w-0">
						<ItemTitle className="invisible min-w-0">{row.name}</ItemTitle>
					</Skeleton>
					<Skeleton className="bg-muted-foreground/25 flex shrink-0 rounded-full">
						<Badge variant="outline" className="invisible">
							{providerBadgeLabel(row)}
						</Badge>
					</Skeleton>
				</div>
			</ItemContent>
			<ItemActions className="shrink-0">
				{row.custom ? (
					<ProviderActionSkeleton icon={<PencilIcon data-icon="inline-start" />}>
						Edit
					</ProviderActionSkeleton>
				) : null}
				{row.canDisconnect && !row.custom ? (
					<ProviderActionSkeleton>Disconnect</ProviderActionSkeleton>
				) : null}
				{row.custom ? <ProviderActionSkeleton>Delete</ProviderActionSkeleton> : null}
			</ItemActions>
		</Item>
	);
}

function ProviderActionSkeleton({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
	return (
		<Skeleton className="bg-muted-foreground/25 flex shrink-0 rounded-lg">
			<Button type="button" variant="outline" size="sm" className="invisible" disabled>
				{icon}
				{children}
			</Button>
		</Skeleton>
	);
}

function ConnectedProvider({
	row,
	pending,
	onDisconnect,
	onEdit,
	onRemove,
}: {
	row: ProviderRow;
	pending: boolean;
	onDisconnect?: () => void;
	onEdit?: () => void;
	onRemove?: () => void;
}) {
	return (
		<Item
			size="sm"
			className="min-w-0 flex-nowrap rounded-none border-0"
			data-qa-id={`kilo-providers-row-${row.id}`}
		>
			<ItemMedia className="border-border bg-background size-8 rounded-lg border">
				<ProviderIcon provider={row.id} variant="color" size={18} fallbackLabel={row.name} />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<ItemTitle className="min-w-0">{row.name}</ItemTitle>
					<Badge variant="outline" className="text-muted-foreground">
						{providerBadgeLabel(row)}
					</Badge>
				</div>
			</ItemContent>
			<ItemActions className="shrink-0">
				{onEdit ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending}
						onClick={onEdit}
						data-qa-id={`kilo-providers-edit-${row.id}`}
					>
						<PencilIcon data-icon="inline-start" />
						Edit
					</Button>
				) : null}
				{onDisconnect ? (
					<Button
						type="button"
						variant="outline"
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
						variant="outline"
						size="sm"
						disabled={pending}
						onClick={onRemove}
						data-qa-id={`kilo-providers-remove-${row.id}`}
					>
						Delete
					</Button>
				) : null}
			</ItemActions>
		</Item>
	);
}

function providerBadgeLabel(row: ProviderRow): string {
	if (row.source === "env") return "Environment Variables";
	if (row.custom) return "Custom";
	return "API key";
}
