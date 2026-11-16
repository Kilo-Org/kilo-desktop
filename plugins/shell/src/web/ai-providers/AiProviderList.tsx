import { useEffect, useState, type ReactNode } from "react";
import { CircleAlertIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";

import type { AiProvider, CustomAiProvider } from "@kilo-desktop/plugin-core/contracts";
import { Alert, AlertAction, AlertTitle } from "@kilo-desktop/ui/components/alert";
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
import { ButtonSkeleton } from "@kilo-desktop/ui/components/button-skeleton";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import { AddProviderDialog } from "./AddProviderDialog";
import {
	aiProviderSourceLabel,
	groupAiProviders,
	isCustom,
	isEnvironmentSourced,
} from "./ai-provider-rows";
import { CustomProviderForm } from "./CustomProviderDialog";
import { ProviderApiKeyEditor } from "./ProviderApiKeyEditor";
import { useAiProviders, type AiProvidersModel } from "./use-ai-providers";

export interface AiProviderListProps {
	/** AI providers drawn by an `ai-provider-panel` (`featured`), left out of the list. */
	readonly hiddenAiProviderIds: readonly string[];
	/**
	 * Rows drawn first in the providers panel (the `ai-provider-panel`
	 * contributions, e.g. Kilo Gateway). The panel stays mounted while the
	 * list loads, so they never change shape or remount when it lands.
	 */
	readonly featured?: ReactNode;
}

type DialogState = null | { type: "add" } | { type: "remove"; provider: AiProvider };

type EditorKind = "custom" | "api";

/** The expanded editor whose save was last submitted; mutation errors belong to it. */
type SubmittedEdit = { aiProviderId: string; kind: EditorKind };

function editorKind(provider: AiProvider): EditorKind | null {
	if (isCustom(provider)) return "custom";
	return provider.canDisconnect ? "api" : null;
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

/**
 * Settings → AI Providers, as origin's page: the header with "Add AI
 * Provider", then one panel of rows — the `featured` AI provider panels
 * first, then direct API keys, custom endpoints and environment credentials
 * over `kilo.core/models`, without exposing the underlying Kilo config as
 * product UI. AI providers with a panel (Kilo Gateway) are left out of the list.
 */
export function AiProviderList({ hiddenAiProviderIds, featured }: AiProviderListProps) {
	const providers = useAiProviders();
	const [dialog, setDialog] = useState<DialogState>(null);
	const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
	const [submitted, setSubmitted] = useState<SubmittedEdit | null>(null);

	if (!providers.available) {
		return (
			<ListShell state="unavailable">
				<p className="text-muted-foreground text-sm" data-qa-id="kilo-providers-unavailable">
					Provider management is available in Kilo Desktop.
				</p>
			</ListShell>
		);
	}

	const addOpen = dialog?.type === "add";
	const removeProvider = dialog?.type === "remove" ? dialog.provider : null;
	const { listed, popular } = groupAiProviders(providers.aiProviders, new Set(hiddenAiProviderIds));
	const blockedIds = Object.keys(providers.aiProviders);
	const loading = providers.loading;

	const editorError = (aiProviderId: string): string | null => {
		if (submitted?.aiProviderId !== aiProviderId) return null;
		return submitted.kind === "custom" ? providers.saveError : providers.connectError;
	};
	// An expanded editor shows its own save error, so the page alert would only repeat it.
	const inlineError =
		submitted && expandedIds.has(submitted.aiProviderId)
			? editorError(submitted.aiProviderId)
			: null;
	const pageError = providers.error === inlineError ? null : providers.error;

	const setExpanded = (aiProviderId: string, open: boolean) => {
		setExpandedIds((current) => {
			const next = new Set(current);
			if (open) next.add(aiProviderId);
			else next.delete(aiProviderId);
			return next;
		});
		if (!open) {
			setSubmitted((current) => (current?.aiProviderId === aiProviderId ? null : current));
		}
	};

	const submitEdit = async (
		aiProviderId: string,
		kind: EditorKind,
		task: () => Promise<unknown>,
	): Promise<void> => {
		// Several editors can be open, but only the latest submission owns an
		// error; clear both so a stale one can't resurface in the page alert.
		providers.resetSave();
		providers.resetConnect();
		setSubmitted({ aiProviderId, kind });
		if (await settle(task)) setExpanded(aiProviderId, false);
	};

	const renderEditor = (provider: AiProvider, kind: EditorKind): ReactNode =>
		kind === "custom" ? (
			<CustomProviderEditor
				provider={provider}
				providers={providers}
				blockedIds={blockedIds}
				error={editorError(provider.id)}
				onCancel={() => setExpanded(provider.id, false)}
				onSubmit={(input) => submitEdit(provider.id, kind, () => providers.saveCustom(input))}
			/>
		) : (
			<ProviderApiKeyEditor
				provider={provider}
				pending={providers.pending}
				error={editorError(provider.id)}
				onCancel={() => setExpanded(provider.id, false)}
				onSubmit={(apiKey) =>
					submitEdit(provider.id, kind, () => providers.connect(provider.id, apiKey))
				}
			/>
		);

	return (
		<ListShell
			state={loading ? "loading" : "ready"}
			action={
				<Button
					type="button"
					size="sm"
					disabled={loading || providers.loadFailed || providers.pending}
					onClick={() => setDialog({ type: "add" })}
					data-qa-id="kilo-providers-add-provider"
				>
					<PlusIcon data-icon="inline-start" />
					Add AI Provider
				</Button>
			}
		>
			{featured || loading || listed.length > 0 ? (
				<section
					className={PROVIDER_PANEL_CLASS}
					aria-label="Providers"
					aria-busy={loading || undefined}
					data-qa-id="kilo-providers-inventory"
				>
					{featured}
					{loading ? (
						<ConnectedProviderSkeleton />
					) : (
						listed.map((provider) => {
							const kind = editorKind(provider);
							const open = expandedIds.has(provider.id);
							return (
								<div key={provider.id}>
									{isEnvironmentSourced(provider) ? (
										<EnvironmentProvider provider={provider} providers={providers} />
									) : (
										<ConnectedProvider
											provider={provider}
											pending={providers.pending}
											{...(kind
												? {
														editor: {
															open,
															onOpenChange: (next: boolean) => setExpanded(provider.id, next),
															content: open ? renderEditor(provider, kind) : null,
														},
													}
												: {})}
											{...(isCustom(provider)
												? { onDelete: () => setDialog({ type: "remove", provider }) }
												: provider.canDisconnect
													? { onDelete: () => void settle(() => providers.disconnect(provider.id)) }
													: {})}
										/>
									)}
								</div>
							);
						})
					)}
				</section>
			) : null}

			{loading ? (
				<span role="status" className="sr-only" data-qa-id="kilo-providers-loading">
					Loading providers
				</span>
			) : null}

			{!loading && pageError ? (
				<Alert variant="destructive" data-qa-id="kilo-providers-error">
					<CircleAlertIcon aria-hidden="true" />
					<AlertTitle>{pageError}</AlertTitle>
					{providers.loadFailed ? (
						<AlertAction>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void providers.reload()}
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
				providers={popular}
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
					if (await settle(() => providers.connect(provider.id, apiKey))) setDialog(null);
				}}
				onSaveCustom={async (input) => {
					if (await settle(() => providers.saveCustom(input))) setDialog(null);
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
								const aiProviderId = removeProvider.id;
								setDialog(null);
								void settle(() => providers.disconnect(aiProviderId));
							}}
						>
							{providers.pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{providers.pending ? "Deleting…" : "Delete AI provider"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ListShell>
	);
}

function ListShell({
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

type CustomProviderLoad =
	| { readonly kind: "loading" }
	| { readonly kind: "loaded"; readonly provider: CustomAiProvider }
	| { readonly kind: "failed"; readonly message: string };

/** A custom provider's inline editor, filled from kilo.core's saved copy (its key masked). */
function CustomProviderEditor({
	provider,
	providers,
	blockedIds,
	error,
	onCancel,
	onSubmit,
}: {
	provider: AiProvider;
	providers: AiProvidersModel;
	blockedIds: readonly string[];
	error: string | null;
	onCancel(): void;
	onSubmit(input: CustomAiProvider): Promise<void>;
}) {
	const [load, setLoad] = useState<CustomProviderLoad>({ kind: "loading" });
	const { readCustom } = providers;

	useEffect(() => {
		let active = true;
		readCustom(provider.id).then(
			(saved) =>
				active &&
				setLoad(
					saved
						? { kind: "loaded", provider: saved }
						: { kind: "failed", message: `${provider.name} can't be edited here.` },
				),
			(reason: unknown) =>
				active &&
				setLoad({
					kind: "failed",
					message: reason instanceof Error ? reason.message : String(reason),
				}),
		);
		return () => {
			active = false;
		};
	}, [readCustom, provider.id, provider.name]);

	if (load.kind === "loading") {
		return (
			<div className="flex flex-col gap-3" data-qa-id="kilo-providers-custom-loading">
				<Skeleton
					role="status"
					aria-label="Loading the provider"
					className="h-8 w-full rounded-lg"
				/>
				<Skeleton className="h-8 w-full rounded-lg" />
			</div>
		);
	}
	if (load.kind === "failed") {
		return (
			<div className="flex items-center justify-between gap-3">
				<FieldError>{load.message}</FieldError>
				<Button type="button" variant="outline" onClick={onCancel}>
					Close
				</Button>
			</div>
		);
	}
	return (
		<CustomProviderForm
			layout="inline"
			existing={load.provider}
			blockedIds={blockedIds}
			pending={providers.pending}
			error={error}
			onCancel={onCancel}
			onSubmit={onSubmit}
		/>
	);
}

/**
 * Stands in for the connected-provider rows until kilo.core has read them.
 * How many exist is unknown, so it reserves a single `ConnectedProvider` row.
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

/** Which of the provider's environment variables are set, read while its details are open. */
function usePresentEnv(
	provider: AiProvider,
	providers: AiProvidersModel,
	open: boolean,
): readonly string[] {
	const [names, setNames] = useState<readonly string[]>([]);
	const { presentEnv } = providers;
	const env = provider.env.join("\n");
	useEffect(() => {
		if (!open || !env) return;
		let active = true;
		presentEnv(env.split("\n")).then(
			(result) => active && setNames(result.names),
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [presentEnv, open, env]);
	return names;
}

function EnvironmentProvider({
	provider,
	providers,
}: {
	provider: AiProvider;
	providers: AiProvidersModel;
}) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const names = usePresentEnv(provider, providers, detailsOpen);
	const label = `Toggle ${provider.name} details`;

	return (
		<Collapsible
			className="min-w-0"
			open={detailsOpen}
			onOpenChange={setDetailsOpen}
			data-qa-id={`kilo-providers-row-${provider.id}`}
			data-state={detailsOpen ? "expanded" : "summary"}
		>
			<SummaryCard.Row>
				<SummaryCard.Trigger
					type="button"
					aria-label={label}
					data-qa-id={`kilo-providers-row-trigger-${provider.id}`}
				>
					<ProviderIdentity provider={provider} />
				</SummaryCard.Trigger>
				<SummaryCard.Actions>
					<SummaryCard.Toggle
						label={label}
						open={detailsOpen}
						data-qa-id={`kilo-providers-toggle-${provider.id}`}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>
				<div
					className="border-border bg-background/60 border-t p-4"
					data-qa-id={`kilo-providers-env-details-${provider.id}`}
				>
					<p className="text-muted-foreground text-sm">
						{provider.source === "env"
							? `${provider.name} is connected using these environment variables.`
							: `${provider.name} is connected using credentials already available on this machine, not a stored API key.`}
					</p>
					{names.length > 0 ? (
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

function ProviderIdentity({ provider }: { provider: AiProvider }) {
	return (
		<>
			<SummaryCard.Icon>
				<ProviderIcon
					provider={provider.id}
					variant="color"
					size={18}
					fallbackLabel={provider.name}
				/>
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title>{provider.name}</SummaryCard.Title>
				<SummaryCard.Description>{aiProviderSourceLabel(provider)}</SummaryCard.Description>
			</SummaryCard.Content>
		</>
	);
}

type ProviderEditor = {
	open: boolean;
	onOpenChange(open: boolean): void;
	/** Rendered only while open so each expansion starts from the saved config. */
	content: ReactNode;
};

function ConnectedProvider({
	provider,
	pending,
	editor,
	onDelete,
}: {
	provider: AiProvider;
	pending: boolean;
	editor?: ProviderEditor;
	onDelete?: () => void;
}) {
	const deleteButton = onDelete ? (
		<DeleteProviderButton provider={provider} pending={pending} onDelete={onDelete} />
	) : null;

	if (!editor) {
		return (
			<SummaryCard.Row data-qa-id={`kilo-providers-row-${provider.id}`}>
				<ProviderIdentity provider={provider} />
				{deleteButton ? <SummaryCard.Actions>{deleteButton}</SummaryCard.Actions> : null}
			</SummaryCard.Row>
		);
	}

	const label = `Toggle ${provider.name} settings`;
	return (
		<Collapsible
			className="min-w-0"
			open={editor.open}
			onOpenChange={editor.onOpenChange}
			data-qa-id={`kilo-providers-row-${provider.id}`}
			data-state={editor.open ? "expanded" : "summary"}
		>
			<SummaryCard.Row>
				<SummaryCard.Trigger
					type="button"
					aria-label={label}
					data-qa-id={`kilo-providers-row-trigger-${provider.id}`}
				>
					<ProviderIdentity provider={provider} />
				</SummaryCard.Trigger>
				<SummaryCard.Actions className="gap-1">
					{deleteButton}
					<SummaryCard.Toggle
						label={label}
						open={editor.open}
						data-qa-id={`kilo-providers-toggle-${provider.id}`}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>
				<section
					aria-label={`${provider.name} settings`}
					className="border-border bg-background/60 min-w-0 border-t p-4"
					data-qa-id={`kilo-providers-editor-${provider.id}`}
				>
					{editor.content}
				</section>
			</CollapsibleContent>
		</Collapsible>
	);
}

function DeleteProviderButton({
	provider,
	pending,
	onDelete,
}: {
	provider: AiProvider;
	pending: boolean;
	onDelete(): void;
}) {
	const label = `Delete ${provider.name}`;
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
						data-qa-id={`kilo-providers-delete-${provider.id}`}
					/>
				}
			>
				<Trash2Icon />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
