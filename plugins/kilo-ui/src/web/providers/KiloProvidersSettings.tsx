import { useState, type ReactNode } from "react";
import { PencilIcon, PlusIcon, RotateCcwIcon, ServerIcon, Trash2Icon } from "lucide-react";

import { useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";
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
import { Button } from "@kilo-desktop/ui/components/button";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";

import type { KiloUiProvidersService } from "../../contracts/providers/schemas.js";
import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { AddProviderDialog } from "./AddProviderDialog.js";
import { CustomProviderDialog } from "./CustomProviderDialog.js";
import type { SanitizedProviderConfig } from "./custom-provider.js";
import { EditProviderApiKeyDialog } from "./EditProviderApiKeyDialog.js";
import { KiloGatewayProviderDisclosure } from "./KiloGatewayProviderCard.js";
import { resolveLocalInferenceCapability } from "./local-inference/capability.js";
import { isEnvironmentSourced, providerSourceLabel, type ProviderRow } from "./provider-list.js";
import { useKiloProviders } from "./use-kilo-providers.js";

const LOCAL_MODEL_SERVER_SETTINGS_PATH = "/settings/local-model-server";

type DialogState =
	| null
	| { type: "add" }
	| { type: "custom"; existing: ProviderRow }
	| { type: "edit-api"; provider: ProviderRow }
	| { type: "remove"; provider: ProviderRow };

async function settle(task: () => Promise<unknown>): Promise<boolean> {
	return task().then(
		() => true,
		() => false,
	);
}

function ProviderEntrySurface({ children }: { children: ReactNode }) {
	return (
		<div className="border-border bg-card min-w-0 overflow-hidden rounded-lg border">
			{children}
		</div>
	);
}

function useLocalInferenceAvailable(): boolean {
	const sdk = useSdk("kilo-ui");
	return resolveLocalInferenceCapability(sdk.plugins.get("local-inference")) !== null;
}

function LocalModelServerLink() {
	const sdk = useSdk("kilo-ui");

	return (
		<ProviderEntrySurface>
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<ServerIcon className="size-[18px]" aria-hidden />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title>Local Model Server</SummaryCard.Title>
					<SummaryCard.Description>Run AI models locally on your device.</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => sdk.navigate(LOCAL_MODEL_SERVER_SETTINGS_PATH)}
						data-qa-id="kilo-providers-local-model-server-link"
					>
						Manage
					</Button>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</ProviderEntrySurface>
	);
}

/**
 * A focused provider switchboard for Kilo chat. Kilo Gateway is the primary
 * path; direct API keys and custom endpoints remain available without exposing
 * the underlying provider config file as product UI. Local inference links to
 * its dedicated settings page when the local-inference plugin is available.
 */
export function KiloProvidersSettings() {
	const connection = useChatConnection();
	const providers = useKiloProviders(connection.connection);
	const localInference = useLocalInferenceAvailable();
	const [dialog, setDialog] = useState<DialogState>(null);

	if (connection.isError) {
		return (
			<PageShell state="unavailable">
				<p className="text-muted-foreground text-sm" data-qa-id="kilo-providers-unavailable">
					Provider management is available in Kilo Desktop.
				</p>
				{localInference ? <LocalModelServerLink /> : null}
			</PageShell>
		);
	}

	const addOpen = dialog?.type === "add";
	const customOpen = dialog?.type === "custom";
	const editProvider = dialog?.type === "edit-api" ? dialog.provider : null;
	const removeProvider = dialog?.type === "remove" ? dialog.provider : null;
	const view = providers.view ?? { connected: [], environment: [], popular: [] };
	const connected = [
		...view.connected.filter((row) => !row.isKilo && !row.isLocal),
		...view.environment,
	].toSorted((left, right) =>
		left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
	);
	const blockedIds = [...providers.ids, ...Object.keys(providers.config?.provider ?? {})];
	const customExisting =
		customOpen && dialog.existing ? toExisting(dialog.existing, providers.config) : null;
	const catalogLoading = connection.isPending || providers.isLoading;
	const pageLoading = catalogLoading;

	const openCustomProvider = (existing: ProviderRow) => {
		providers.resetSave();
		setDialog({ type: "custom", existing });
	};
	const openApiProvider = (provider: ProviderRow) => {
		providers.resetConnect();
		setDialog({ type: "edit-api", provider });
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
					Add AI Provider
				</Button>
			}
		>
			{pageLoading ? (
				<ProvidersContentLoadingState />
			) : (
				<>
					<section
						className="flex min-w-0 flex-col gap-2"
						aria-label="Providers"
						data-qa-id="kilo-providers-inventory"
					>
						<ProviderEntrySurface>
							<KiloGatewayProviderDisclosure />
						</ProviderEntrySurface>
						{localInference ? <LocalModelServerLink /> : null}
						{connected.map((row) => (
							<ProviderEntrySurface key={row.id}>
								{isEnvironmentSourced(row) ? (
									<EnvironmentProvider row={row} />
								) : (
									<ConnectedProvider
										row={row}
										pending={providers.pending}
										{...(row.canDisconnect && !row.custom
											? { onDisconnect: () => void settle(() => providers.disconnect(row.id)) }
											: {})}
										{...(row.custom
											? { onEdit: () => openCustomProvider(row) }
											: row.canDisconnect
												? { onEdit: () => openApiProvider(row) }
												: {})}
										{...(row.custom
											? { onRemove: () => setDialog({ type: "remove", provider: row }) }
											: {})}
									/>
								)}
							</ProviderEntrySurface>
						))}
					</section>

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

			<EditProviderApiKeyDialog
				key={`edit-api:${editProvider?.id ?? "closed"}`}
				open={editProvider !== null}
				provider={editProvider}
				pending={providers.pending}
				error={providers.connectError}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
				onSubmit={async (apiKey) => {
					if (!editProvider) return;
					const didSave = await settle(() =>
						providers.connect({ providerID: editProvider.id, apiKey }),
					);
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
							{providers.pending ? "Deleting…" : "Delete AI Provider"}
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
			className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6"
			data-qa-id="kilo-providers-page"
			data-state={state}
		>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1
						className="text-base font-semibold tracking-tight"
						data-qa-id="settings-section-heading"
					>
						AI Providers
					</h1>
					<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
						Choose where your models come from.
					</p>
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</header>
			{children}
		</div>
	);
}

function ProvidersContentLoadingState() {
	return (
		<section
			className="flex min-w-0 flex-col gap-2"
			aria-label="Loading providers"
			data-qa-id="kilo-providers-loading"
		>
			<span className="sr-only" role="status">
				Loading providers
			</span>
			<ProviderEntrySurface>
				<GatewayProviderLoadingState />
			</ProviderEntrySurface>
			<ProviderEntrySurface>
				<ProviderLoadingRow compact qaId="kilo-providers-loading-provider">
					<Skeleton className="bg-muted-foreground/25 h-7 w-14 rounded-lg" />
				</ProviderLoadingRow>
			</ProviderEntrySurface>
		</section>
	);
}

function GatewayProviderLoadingState() {
	return (
		<ProviderLoadingRow qaId="kilo-providers-loading-gateway">
			<Skeleton className="bg-muted-foreground/25 h-7 w-14 rounded-lg" />
		</ProviderLoadingRow>
	);
}

function ProviderLoadingRow({
	children,
	compact = false,
	qaId,
}: {
	children?: ReactNode;
	compact?: boolean;
	qaId: string;
}) {
	return (
		<SummaryCard.Row className="min-h-[54px]" aria-hidden="true" data-qa-id={qaId}>
			<SummaryCard.Icon>
				<Skeleton className="bg-muted-foreground/25 size-[18px] rounded-sm" />
			</SummaryCard.Icon>
			<SummaryCard.Content className="group-data-[size=xs]/item:gap-1.5">
				<Skeleton
					className={
						compact ? "bg-muted-foreground/25 h-3.5 w-24" : "bg-muted-foreground/25 h-3.5 w-32"
					}
				/>
				<Skeleton
					className={
						compact
							? "bg-muted-foreground/25 h-3 w-44 max-w-full"
							: "bg-muted-foreground/25 h-3 w-64 max-w-full"
					}
				/>
			</SummaryCard.Content>
			{children ? <SummaryCard.Actions>{children}</SummaryCard.Actions> : null}
		</SummaryCard.Row>
	);
}

function EnvironmentProvider({ row }: { row: ProviderRow }) {
	const sdk = useSdk<KiloUiProvidersService>("kilo-ui");
	const present = useSdkQuery(sdk, "providers.presentEnv", { names: [...row.env] });
	const [detailsOpen, setDetailsOpen] = useState(false);
	const label = `Toggle ${row.name} details`;
	const names = present.data?.names ?? [];

	return (
		<Collapsible
			className="min-w-0"
			open={detailsOpen}
			onOpenChange={setDetailsOpen}
			data-qa-id={`kilo-providers-row-${row.id}`}
			data-state={detailsOpen ? "expanded" : "summary"}
		>
			<SummaryCard.Row>
				<SummaryCard.Trigger
					type="button"
					aria-label={label}
					data-qa-id={`kilo-providers-row-trigger-${row.id}`}
				>
					<SummaryCard.Icon>
						<ProviderIcon provider={row.id} variant="color" size={18} fallbackLabel={row.name} />
					</SummaryCard.Icon>
					<SummaryCard.Content>
						<SummaryCard.Title>{row.name}</SummaryCard.Title>
						<SummaryCard.Description>{providerSourceLabel(row)}</SummaryCard.Description>
					</SummaryCard.Content>
				</SummaryCard.Trigger>
				<SummaryCard.Actions>
					<SummaryCard.Toggle
						label={label}
						open={detailsOpen}
						data-qa-id={`kilo-providers-toggle-${row.id}`}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>
				<div
					className="border-border bg-background/60 border-t p-3"
					data-qa-id={`kilo-providers-env-details-${row.id}`}
				>
					<p className="text-muted-foreground text-sm">
						{row.source === "env"
							? `${row.name} is connected using these environment variables.`
							: `${row.name} is connected using credentials already available on this machine, not a stored API key.`}
					</p>
					{present.isSuccess && names.length > 0 ? (
						<ul className="mt-3 flex flex-col gap-1">
							{names.map((name) => (
								<li key={name} className="font-mono text-xs break-all">
									{name}
								</li>
							))}
						</ul>
					) : null}
				</div>
			</CollapsibleContent>
		</Collapsible>
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
		<TooltipProvider>
			<SummaryCard.Row data-qa-id={`kilo-providers-row-${row.id}`}>
				<SummaryCard.Icon>
					<ProviderIcon provider={row.id} variant="color" size={18} fallbackLabel={row.name} />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title>{row.name}</SummaryCard.Title>
					<SummaryCard.Description>{providerSourceLabel(row)}</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions>
					<div
						className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover/summary-card:opacity-100 group-has-[:focus-visible]/summary-card:opacity-100"
						data-qa-id={`kilo-providers-actions-${row.id}`}
					>
						{onEdit ? (
							<ProviderIconAction
								label={`Edit ${row.name}`}
								pending={pending}
								onClick={onEdit}
								qaId={`kilo-providers-edit-${row.id}`}
								icon={<PencilIcon />}
							/>
						) : null}
						{onDisconnect ? (
							<ProviderIconAction
								label={`Delete ${row.name}`}
								pending={pending}
								onClick={onDisconnect}
								qaId={`kilo-providers-disconnect-${row.id}`}
								icon={<Trash2Icon />}
								destructive
							/>
						) : null}
						{onRemove ? (
							<ProviderIconAction
								label={`Delete ${row.name}`}
								pending={pending}
								onClick={onRemove}
								qaId={`kilo-providers-remove-${row.id}`}
								icon={<Trash2Icon />}
								destructive
							/>
						) : null}
					</div>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</TooltipProvider>
	);
}

function ProviderIconAction({
	label,
	pending,
	onClick,
	qaId,
	icon,
	destructive = false,
}: {
	label: string;
	pending: boolean;
	onClick: () => void;
	qaId: string;
	icon: ReactNode;
	destructive?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={destructive ? "hover:text-destructive" : undefined}
						aria-label={label}
						disabled={pending}
						onClick={onClick}
						data-qa-id={qaId}
					/>
				}
			>
				{icon}
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
