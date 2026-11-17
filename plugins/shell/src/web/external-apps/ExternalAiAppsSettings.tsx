import { CheckIcon, CopyIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { DomainObjectMethods } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	EXTERNAL_APP_NAME_MAX_LENGTH,
	ExternalApps,
	type ExternalApp,
	type ExternalAppsState,
} from "@kilo-desktop/plugin-core/contracts";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";

import {
	EXTERNAL_CLIENT_KINDS,
	externalClientSetup,
	type ExternalClientKind,
} from "./external-client-snippets";

type ExternalAppsMethods = DomainObjectMethods<typeof ExternalApps>;

const selectState = (state: ExternalAppsState) => state;

/** Runs the domain's methods, tracking whether one is in flight and the last failure. */
function useExternalAppsActions() {
	const apps = useDomainObject(ExternalApps);
	const [pending, setPending] = useState(0);
	const [error, setError] = useState<Error | null>(null);
	const run = async <T,>(
		action: (methods: ExternalAppsMethods) => Promise<T>,
	): Promise<T | undefined> => {
		if (!apps) return undefined;
		setPending((count) => count + 1);
		setError(null);
		let result: T | undefined;
		try {
			result = await action(apps.methods);
		} catch (caught) {
			setError(caught instanceof Error ? caught : new Error(String(caught)));
		}
		setPending((count) => count - 1);
		return result;
	};
	return { run, busy: pending > 0, error };
}

/** Labels do not depend on the URL or token. */
const CLIENT_KIND_ITEMS = EXTERNAL_CLIENT_KINDS.map((kind) => ({
	value: kind,
	label: externalClientSetup(kind, "", "").label,
}));

interface PairedApp {
	readonly app: ExternalApp;
	readonly token: string;
	readonly url: string;
}

function endpointUrl(state: ExternalAppsState): string {
	return state.listener.status === "running"
		? state.listener.url
		: `http://127.0.0.1:${state.port}/mcp`;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="outline"
			size="sm"
			aria-label={label}
			onClick={() => {
				void navigator.clipboard.writeText(text).then(() => setCopied(true));
			}}
		>
			{copied ? <CheckIcon /> : <CopyIcon />}
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

function PairedAppDialog({
	paired,
	onClose,
}: {
	readonly paired: PairedApp | undefined;
	readonly onClose: () => void;
}) {
	const [kind, setKind] = useState<ExternalClientKind>("generic");
	const setup = paired ? externalClientSetup(kind, paired.url, paired.token) : undefined;
	const close = () => {
		setKind("generic");
		onClose();
	};
	return (
		<Dialog open={paired !== undefined} onOpenChange={(open) => !open && close()}>
			<DialogContent className="sm:max-w-2xl" data-qa-id="external-client-token-dialog">
				{paired && setup ? (
					<>
						<DialogHeader>
							<DialogTitle>Connect {paired.app.name}</DialogTitle>
							<DialogDescription>
								Copy the token now. Kilo Desktop only keeps a fingerprint of it, so it cannot be
								shown again.
							</DialogDescription>
						</DialogHeader>
						<div className="flex min-w-0 items-center gap-2">
							<code
								className="bg-muted min-w-0 flex-1 truncate rounded-md px-2 py-1.5 font-mono text-xs"
								data-qa-id="external-client-token"
							>
								{paired.token}
							</code>
							<CopyButton text={paired.token} label="Copy token" />
						</div>
						<section className="flex min-w-0 flex-col gap-2">
							<div className="flex items-center justify-between gap-2">
								<label htmlFor="external-client-kind" className="text-sm font-medium">
									Set up in
								</label>
								<Select
									items={CLIENT_KIND_ITEMS}
									value={kind}
									onValueChange={(value) => {
										if (value) setKind(value as ExternalClientKind);
									}}
								>
									<SelectTrigger
										id="external-client-kind"
										className="w-48"
										aria-label="Set up in"
										data-qa-id="external-client-kind"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{CLIENT_KIND_ITEMS.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							{/* Fixed heights keep the dialog the same size for every client. */}
							<div className="flex items-start justify-between gap-2">
								<p
									className="text-muted-foreground line-clamp-2 h-8 min-w-0 flex-1 text-xs"
									data-qa-id="external-client-setup-description"
								>
									{setup.description}
								</p>
								<CopyButton text={setup.code} label={`Copy ${setup.label} configuration`} />
							</div>
							{/* The slot reserves the tallest config's height; the box itself fits its content. */}
							<div className="h-64 min-w-0">
								<pre
									className="bg-muted max-h-full overflow-auto rounded-md p-2 font-mono text-xs wrap-break-word whitespace-pre-wrap"
									data-qa-id="external-client-setup"
								>
									{setup.code}
								</pre>
							</div>
						</section>
						<DialogFooter>
							<Button onClick={close} data-qa-id="external-client-token-done">
								Done
							</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RemoveAppDialog({
	app,
	onConfirm,
	onClose,
}: {
	readonly app: ExternalApp | undefined;
	readonly onConfirm: (app: ExternalApp) => void;
	readonly onClose: () => void;
}) {
	return (
		<AlertDialog open={app !== undefined} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent data-qa-id="external-client-remove-dialog">
				{app ? (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove {app.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								The app is disconnected immediately and its token stops working. To use it again,
								pair it again with a new token.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => {
									onConfirm(app);
									onClose();
								}}
								data-qa-id="external-client-remove-confirm"
							>
								Remove
							</AlertDialogAction>
						</AlertDialogFooter>
					</>
				) : null}
			</AlertDialogContent>
		</AlertDialog>
	);
}

function StatusDescription({ state }: { readonly state: ExternalAppsState }) {
	if (state.listener.status === "running") {
		return (
			<>
				Listening on <code className="font-mono">{state.listener.url}</code>
			</>
		);
	}
	if (state.listener.status === "error") return <>Not running</>;
	return <>Off</>;
}

/** Settings → External AI apps: the endpoint paired apps use, and pairing and removing them. */
export function ExternalAiAppsSettings() {
	const state = useDomainObjectState(ExternalApps, selectState);
	const actions = useExternalAppsActions();
	const [name, setName] = useState("");
	const [portDraft, setPortDraft] = useState<string | undefined>(undefined);
	const [paired, setPaired] = useState<PairedApp | undefined>(undefined);
	const [removing, setRemoving] = useState<ExternalApp | undefined>(undefined);

	const busy = state === undefined || actions.busy;
	const error = actions.error;
	const setEnabled = (enabled: boolean) =>
		void actions.run((methods) => methods.setEnabled({ enabled }));
	const setPort = (port: number | null) =>
		void actions.run(async (methods) => {
			await methods.setPort({ port });
			setPortDraft(undefined);
		});
	const pairingAllowed = state?.enabled === true;
	const portValue = portDraft ?? (state ? String(state.port) : "");
	const parsedPort = Number(portValue);
	const portValid = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535;
	const portChanged = state !== undefined && portValid && parsedPort !== state.port;

	const savePort = (event: FormEvent) => {
		event.preventDefault();
		if (!portChanged) return;
		setPort(parsedPort);
	};

	const pairApp = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || !state?.enabled) return;
		const url = endpointUrl(state);
		void actions.run(async (methods) => {
			const result = await methods.pair({ name: trimmed });
			setName("");
			setPaired({ app: result.app, token: result.token, url });
		});
	};

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="external-ai-apps-settings">
			<SettingsPageHeader />
			<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
				<div className="divide-border divide-y">
					<div>
						<SummaryCard.Row>
							<SummaryCard.Content>
								<SummaryCard.Title>
									<label htmlFor="external-ai-apps-enabled">Allow external AI apps</label>
								</SummaryCard.Title>
								<SummaryCard.Description className="line-clamp-none">
									Paired apps such as Cursor or Claude Code can use the same Kilo Desktop tools as
									the built-in agent, including changing environments. They ask for approval
									themselves, not Kilo Desktop.
								</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
								<Switch
									id="external-ai-apps-enabled"
									checked={state?.enabled ?? false}
									disabled={busy || state === undefined}
									onCheckedChange={setEnabled}
									aria-label="Allow external AI apps"
									data-qa-id="external-ai-apps-enabled"
								/>
							</SummaryCard.Actions>
						</SummaryCard.Row>
					</div>
					{state ? (
						<div>
							<SummaryCard.Row>
								<SummaryCard.Content>
									<SummaryCard.Title>Endpoint</SummaryCard.Title>
									<SummaryCard.Description
										className="line-clamp-none"
										data-qa-id="external-ai-apps-status"
									>
										<StatusDescription state={state} />
									</SummaryCard.Description>
								</SummaryCard.Content>
								<SummaryCard.Actions>
									<form className="flex items-center gap-2" onSubmit={savePort}>
										<label htmlFor="external-ai-apps-port" className="text-sm">
											Port
										</label>
										<Input
											id="external-ai-apps-port"
											inputMode="numeric"
											className="w-24"
											value={portValue}
											aria-invalid={!portValid}
											onChange={(event) => setPortDraft(event.target.value)}
											data-qa-id="external-ai-apps-port"
										/>
										<Button
											type="submit"
											variant="outline"
											size="sm"
											disabled={busy || !portChanged}
											data-qa-id="external-ai-apps-port-save"
										>
											Save
										</Button>
										{state.port !== state.defaultPort ? (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												disabled={busy}
												onClick={() => setPort(null)}
											>
												Use default ({state.defaultPort})
											</Button>
										) : null}
									</form>
								</SummaryCard.Actions>
							</SummaryCard.Row>
						</div>
					) : null}
				</div>
			</div>
			{state?.listener.status === "error" ? (
				<Alert variant="destructive" data-qa-id="external-ai-apps-error">
					<AlertTitle>External AI apps endpoint is not running</AlertTitle>
					<AlertDescription>{state.listener.message}</AlertDescription>
				</Alert>
			) : null}

			<section className="flex min-w-0 flex-col gap-3">
				<div>
					<h2 className="text-sm font-medium">Paired apps</h2>
					<p className="text-muted-foreground text-sm">
						Each app gets its own token. Remove an app to disconnect it immediately.
					</p>
				</div>
				{state && state.apps.length > 0 ? (
					<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
						<ul className="divide-border divide-y" data-qa-id="external-ai-apps-clients">
							{state.apps.map((app) => (
								<li key={app.id}>
									<SummaryCard.Row>
										<SummaryCard.Content>
											<SummaryCard.Title>{app.name}</SummaryCard.Title>
											<SummaryCard.Description>
												Added {formatDate(app.createdAt)}
												{app.lastUsedAt ? ` · Last used ${formatDate(app.lastUsedAt)}` : ""}
											</SummaryCard.Description>
										</SummaryCard.Content>
										<SummaryCard.Actions>
											<Button
												variant="destructive"
												size="sm"
												disabled={busy}
												aria-label={`Remove ${app.name}`}
												onClick={() => setRemoving(app)}
											>
												Remove
											</Button>
										</SummaryCard.Actions>
									</SummaryCard.Row>
								</li>
							))}
						</ul>
					</div>
				) : (
					<p className="text-muted-foreground text-sm">No apps paired yet.</p>
				)}
				<form className="flex min-w-0 items-center gap-2" onSubmit={pairApp}>
					<Input
						aria-label="App name"
						placeholder="App name, e.g. Cursor on this Mac"
						maxLength={EXTERNAL_APP_NAME_MAX_LENGTH}
						value={name}
						disabled={!pairingAllowed}
						onChange={(event) => setName(event.target.value)}
						data-qa-id="external-ai-apps-client-name"
					/>
					<Button
						type="submit"
						disabled={busy || !pairingAllowed || name.trim().length === 0}
						data-qa-id="external-ai-apps-pair"
					>
						Pair app
					</Button>
				</form>
				{state && !state.enabled ? (
					<p className="text-muted-foreground text-sm" data-qa-id="external-ai-apps-pair-hint">
						Turn on Allow external AI apps to pair an app.
					</p>
				) : null}
			</section>

			{error ? <FieldError className="text-sm">{error.message}</FieldError> : null}
			<PairedAppDialog paired={paired} onClose={() => setPaired(undefined)} />
			<RemoveAppDialog
				app={removing}
				onConfirm={(app) => void actions.run((methods) => methods.revoke({ id: app.id }))}
				onClose={() => setRemoving(undefined)}
			/>
		</div>
	);
}
