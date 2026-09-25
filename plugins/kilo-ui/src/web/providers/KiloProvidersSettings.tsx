import { useState, type ReactNode } from "react";
import {
	CircleAlertIcon,
	PlusIcon,
	RefreshCwIcon,
	ServerIcon,
	SettingsIcon,
	Trash2Icon,
} from "lucide-react";

import { SettingsPageHeader, useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";
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
import { Alert, AlertAction, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button } from "@kilo-desktop/ui/components/button";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { KiloUiProvidersService } from "../../contracts/providers/schemas.js";
import { ButtonSkeleton } from "../account/ButtonSkeleton.js";
import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { AddProviderDialog } from "./AddProviderDialog.js";
import { CustomProviderForm } from "./CustomProviderDialog.js";
import type { SanitizedProviderConfig } from "./custom-provider.js";
import { KiloGatewayProviderDisclosure } from "./KiloGatewayProviderCard.js";
import { resolveLocalInferenceCapability } from "./local-inference/capability.js";
import { ProviderApiKeyEditor } from "./ProviderApiKeyEditor.js";
import { isEnvironmentSourced, providerSourceLabel, type ProviderRow } from "./provider-list.js";
import { useKiloProviders } from "./use-kilo-providers.js";

const LOCAL_MODEL_SERVER_SETTINGS_PATH = "/settings/local-model-server";

type DialogState = null | { type: "add" } | { type: "remove"; provider: ProviderRow };

type EditorKind = "custom" | "api";

/** The expanded editor whose save was last submitted; mutation errors belong to it. */
type SubmittedEdit = { providerID: string; kind: EditorKind };

function editorKind(row: ProviderRow): EditorKind | null {
	if (row.custom) return "custom";
	return row.canDisconnect ? "api" : null;
}

async function settle(task: () => Promise<unknown>): Promise<boolean> {
	return task().then(
		() => true,
		() => false,
	);
}

/** One bordered panel of joined rows, the settings pattern for configured entities. */
const PROVIDER_PANEL_CLASS =
	"border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border";

function useLocalInferenceAvailable(): boolean {
	const sdk = useSdk("kilo-ui");
	return resolveLocalInferenceCapability(sdk.plugins.get("local-inference")) !== null;
}

function LocalModelServerLink() {
	const sdk = useSdk("kilo-ui");

	return (
		<div>
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
						variant="outline"
						size="sm"
						onClick={() => sdk.navigate(LOCAL_MODEL_SERVER_SETTINGS_PATH)}
						data-qa-id="kilo-providers-local-model-server-link"
					>
						<SettingsIcon data-icon="inline-start" />
						Manage
					</Button>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</div>
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
	const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
	const [submitted, setSubmitted] = useState<SubmittedEdit | null>(null);

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
	const removeProvider = dialog?.type === "remove" ? dialog.provider : null;
	const view = providers.view ?? { connected: [], environment: [], popular: [] };
	const connected = [
		...view.connected.filter((row) => !row.isKilo && !row.isLocal),
		...view.environment,
	].toSorted((left, right) =>
		left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
	);
	const blockedIds = [...providers.ids, ...Object.keys(providers.config?.provider ?? {})];
	const catalogLoading = connection.isPending || providers.isLoading;
	const pageLoading = catalogLoading;

	const editorError = (providerID: string): string | null => {
		if (submitted?.providerID !== providerID) return null;
		return submitted.kind === "custom" ? providers.saveError : providers.connectError;
	};
	// An expanded editor shows its own save error, so the page alert would only repeat it.
	const inlineError =
		submitted && expandedIds.has(submitted.providerID) ? editorError(submitted.providerID) : null;
	const pageError = providers.error === inlineError ? null : providers.error;

	const setExpanded = (providerID: string, open: boolean) => {
		setExpandedIds((current) => {
			const next = new Set(current);
			if (open) next.add(providerID);
			else next.delete(providerID);
			return next;
		});
		if (!open) {
			setSubmitted((current) => (current?.providerID === providerID ? null : current));
		}
	};

	const submitEdit = async (
		providerID: string,
		kind: EditorKind,
		task: () => Promise<unknown>,
	): Promise<void> => {
		// Several editors can be open, but only the latest submission owns an
		// error; clear both so a stale one can't resurface in the page alert.
		providers.resetSave();
		providers.resetConnect();
		setSubmitted({ providerID, kind });
		if (await settle(task)) setExpanded(providerID, false);
	};

	const renderEditor = (row: ProviderRow, kind: EditorKind): ReactNode =>
		kind === "custom" ? (
			<CustomProviderForm
				layout="inline"
				existing={toExisting(row, providers.config)}
				blockedIds={blockedIds}
				pending={providers.pending}
				error={editorError(row.id)}
				onCancel={() => setExpanded(row.id, false)}
				onSubmit={(input) => submitEdit(row.id, kind, () => providers.saveCustom(input))}
			/>
		) : (
			<ProviderApiKeyEditor
				provider={row}
				pending={providers.pending}
				error={editorError(row.id)}
				onCancel={() => setExpanded(row.id, false)}
				onSubmit={(apiKey) =>
					submitEdit(row.id, kind, () => providers.connect({ providerID: row.id, apiKey }))
				}
			/>
		);

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
			{/* The inventory panel stays mounted while loading so the Kilo Gateway card
			    (which owns its own loading state) and the synchronously known Local
			    Model Server row don't change shape or remount when the catalog lands;
			    only the connected-provider rows wait for it, behind a placeholder row. */}
			<section
				className={PROVIDER_PANEL_CLASS}
				aria-label="Providers"
				aria-busy={pageLoading || undefined}
				data-qa-id="kilo-providers-inventory"
			>
				<div>
					<KiloGatewayProviderDisclosure />
				</div>
				{localInference ? <LocalModelServerLink /> : null}
				{pageLoading ? (
					<ConnectedProviderSkeleton />
				) : (
					connected.map((row) => {
						const kind = editorKind(row);
						const open = expandedIds.has(row.id);
						return (
							<div key={row.id}>
								{isEnvironmentSourced(row) ? (
									<EnvironmentProvider row={row} />
								) : (
									<ConnectedProvider
										row={row}
										pending={providers.pending}
										{...(kind
											? {
													editor: {
														open,
														onOpenChange: (next: boolean) => setExpanded(row.id, next),
														content: open ? renderEditor(row, kind) : null,
													},
												}
											: {})}
										{...(row.custom
											? { onDelete: () => setDialog({ type: "remove", provider: row }) }
											: row.canDisconnect
												? { onDelete: () => void settle(() => providers.disconnect(row.id)) }
												: {})}
									/>
								)}
							</div>
						);
					})
				)}
			</section>

			{pageLoading ? (
				<span role="status" className="sr-only" data-qa-id="kilo-providers-loading">
					Loading providers
				</span>
			) : null}

			{!pageLoading && pageError ? (
				<Alert variant="destructive" data-qa-id="kilo-providers-error">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>{pageError}</AlertTitle>
					{providers.isError ? (
						<AlertAction>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									void providers.reload();
								}}
								data-qa-id="kilo-providers-retry"
							>
								<RefreshCwIcon data-icon="inline-start" />
								Try again
							</Button>
						</AlertAction>
					) : null}
				</Alert>
			) : null}

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
							{providers.pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{providers.pending ? "Deleting…" : "Delete AI provider"}
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
			className="flex min-w-0 flex-col gap-6"
			data-qa-id="kilo-providers-page"
			data-state={state}
		>
			<SettingsPageHeader actions={action} />
			{children}
		</div>
	);
}

/**
 * Stands in for the connected-provider rows until the catalog lands. How many
 * exist is unknown, so it reserves a single `ConnectedProvider` row.
 */
function ConnectedProviderSkeleton() {
	return (
		<div aria-hidden="true" data-qa-id="kilo-providers-loading-provider">
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<Skeleton className="size-[18px] rounded-sm" />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title>
						<SkeletonText className="w-24" />
					</SummaryCard.Title>
					<SummaryCard.Description>
						<SkeletonText className="w-32" />
					</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions>
					<ButtonSkeleton size="icon-sm">
						<Trash2Icon />
					</ButtonSkeleton>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</div>
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
					className="border-border bg-background/60 border-t p-4"
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

type ProviderEditor = {
	open: boolean;
	onOpenChange(open: boolean): void;
	/** Rendered only while open so each expansion starts from the saved config. */
	content: ReactNode;
};

function ConnectedProvider({
	row,
	pending,
	editor,
	onDelete,
}: {
	row: ProviderRow;
	pending: boolean;
	editor?: ProviderEditor;
	onDelete?: () => void;
}) {
	const identity = (
		<>
			<SummaryCard.Icon>
				<ProviderIcon provider={row.id} variant="color" size={18} fallbackLabel={row.name} />
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title>{row.name}</SummaryCard.Title>
				<SummaryCard.Description>{providerSourceLabel(row)}</SummaryCard.Description>
			</SummaryCard.Content>
		</>
	);
	const deleteButton = onDelete ? (
		<DeleteProviderButton row={row} pending={pending} onDelete={onDelete} />
	) : null;

	if (!editor) {
		return (
			<SummaryCard.Row data-qa-id={`kilo-providers-row-${row.id}`}>
				{identity}
				{deleteButton ? <SummaryCard.Actions>{deleteButton}</SummaryCard.Actions> : null}
			</SummaryCard.Row>
		);
	}

	const label = `Toggle ${row.name} settings`;
	return (
		<Collapsible
			className="min-w-0"
			open={editor.open}
			onOpenChange={editor.onOpenChange}
			data-qa-id={`kilo-providers-row-${row.id}`}
			data-state={editor.open ? "expanded" : "summary"}
		>
			<SummaryCard.Row>
				<SummaryCard.Trigger
					type="button"
					aria-label={label}
					data-qa-id={`kilo-providers-row-trigger-${row.id}`}
				>
					{identity}
				</SummaryCard.Trigger>
				<SummaryCard.Actions className="gap-1">
					{deleteButton}
					<SummaryCard.Toggle
						label={label}
						open={editor.open}
						data-qa-id={`kilo-providers-toggle-${row.id}`}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>
				<section
					aria-label={`${row.name} settings`}
					className="border-border bg-background/60 min-w-0 border-t p-4"
					data-qa-id={`kilo-providers-editor-${row.id}`}
				>
					{editor.content}
				</section>
			</CollapsibleContent>
		</Collapsible>
	);
}

function DeleteProviderButton({
	row,
	pending,
	onDelete,
}: {
	row: ProviderRow;
	pending: boolean;
	onDelete(): void;
}) {
	const label = `Delete ${row.name}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="text-muted-foreground hover:text-destructive"
						aria-label={label}
						disabled={pending}
						onClick={onDelete}
						data-qa-id={`kilo-providers-delete-${row.id}`}
					/>
				}
			>
				<Trash2Icon />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
