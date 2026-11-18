import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@kilo-desktop/ui/components/alert";
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
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { BoxIcon, PlusIcon, SearchIcon, SearchXIcon, ShieldAlertIcon } from "lucide-react";

import { parseEnvironmentsErrorMessage } from "../../../contracts/common";
import type { CondaEnv } from "../../../contracts/providers/conda";
import { condaQueryOptions, useConda, useCondaMutation, useCondaQuery } from "../../conda";
import { AddPackageDialog } from "./AddPackageDialog";
import { CreateEnvironmentDialog } from "./CreateEnvironmentDialog";
import { environmentDisplayName, suggestEnvironmentName } from "./environment-display";
import { friendlyEnvironmentsError } from "./environments-error-message";
import type { PackageInstallLink } from "./package-install-link";
import type { PackageInstallPreset } from "./PackageSearch";

export type PackageInstallRequest = Extract<PackageInstallLink, { kind: "install" }>;

interface PackageInstallRequestDialogProps {
	readonly request: PackageInstallRequest;
	/** The flow ended: installed, created, or cancelled. */
	readonly onDone: () => void;
	/** Shows an environment the package was just installed into. */
	readonly onOpenEnvironment: (prefix: string) => void;
}

/** What the person decided about a channel the configured ones don't provide. */
type ChannelChoice = "once" | "added";

type Stage =
	| { readonly kind: "choose" }
	| { readonly kind: "add-packages"; readonly env: CondaEnv; readonly preset: PackageInstallPreset }
	| {
			readonly kind: "create";
			readonly preset: PackageInstallPreset;
			readonly name: string;
	  };

/**
 * An install link's flow, on top of the environments list:
 *
 * 1. **Checking** (only with a channel): whether the configured channels
 *    already provide it. The check can wait behind a running conda job.
 * 2. **Channel not configured**: install from it once, add it and install,
 *    or cancel. Adding a channel is the person's decision.
 * 3. **Target**: a new environment (named after the package) or an
 *    existing one.
 *
 * It then hands over to Add packages or Create environment, opened with the
 * package selected and the link's channel ahead of the others.
 */
export function PackageInstallRequestDialog({
	request,
	onDone,
	onOpenEnvironment,
}: PackageInstallRequestDialogProps) {
	const conda = useConda();
	const { channel } = request;
	const [stage, setStage] = useState<Stage>({ kind: "choose" });
	const [channelChoice, setChannelChoice] = useState<ChannelChoice | null>(null);
	const created = useRef<CondaEnv | null>(null);

	const resolution = useQuery({
		...condaQueryOptions(conda, "resolveChannel", { channel: channel ?? "" }),
		enabled: channel !== undefined,
		retry: false,
		// Each link asks afresh; main caches the answer briefly.
		gcTime: 0,
	});
	const addChannel = useCondaMutation(conda, "addChannel", {
		invalidates: ["listChannels", "prefixOptions", "findRepodata"],
	});

	const invalidChannel = resolution.isError && errorCode(resolution.error) === "INVALID_CHANNEL";
	useEffect(() => {
		if (!invalidChannel) return;
		toast.error("This install link is invalid.", {
			description: "Its channel is not one conda can use.",
		});
		onDone();
	}, [invalidChannel, onDone]);

	const preset = (): PackageInstallPreset => {
		const packages = [{ name: request.package, version: request.version ?? null }];
		// Passed even when configured: it goes first, so conda installs the
		// package from it rather than from another channel that also has it.
		return channel ? { packages, channels: [channel] } : { packages };
	};

	if (stage.kind === "add-packages") {
		return (
			<AddPackageDialog
				env={stage.env}
				open
				preset={stage.preset}
				onInstalled={() => onOpenEnvironment(stage.env.prefix)}
				onClose={onDone}
			/>
		);
	}

	if (stage.kind === "create") {
		return (
			<CreateEnvironmentDialog
				open
				preset={stage.preset}
				initialName={stage.name}
				onCreated={(environment) => {
					created.current = environment;
				}}
				onClose={() => {
					onDone();
					if (created.current) onOpenEnvironment(created.current.prefix);
				}}
			/>
		);
	}

	if (invalidChannel) return null;

	const step = !channel
		? "target"
		: resolution.isPending
			? "checking"
			: resolution.isError
				? "check-failed"
				: !resolution.data.configured && channelChoice === null
					? "channel"
					: "target";

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onDone();
			}}
		>
			<DialogContent
				className="sm:max-w-lg"
				data-qa-id="environments-install-link-dialog"
				data-step={step}
			>
				{step === "checking" ? (
					<CheckingStep request={request} onCancel={onDone} />
				) : step === "check-failed" ? (
					<CheckFailedStep
						request={request}
						error={resolution.error}
						onRetry={() => void resolution.refetch()}
						onCancel={onDone}
					/>
				) : step === "channel" ? (
					<ChannelStep
						request={request}
						exact={resolution.data?.exact ?? true}
						adding={addChannel.isPending}
						addError={addChannel.error}
						onInstallOnce={() => setChannelChoice("once")}
						onAddAndInstall={() =>
							addChannel.mutate(
								{ channel: channel! },
								{ onSuccess: () => setChannelChoice("added") },
							)
						}
						onCancel={onDone}
					/>
				) : (
					<TargetStep
						request={request}
						onChooseEnvironment={(env) => setStage({ kind: "add-packages", env, preset: preset() })}
						onChooseNew={(name) => setStage({ kind: "create", preset: preset(), name })}
						onCancel={onDone}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function errorCode(error: unknown): string | undefined {
	return error instanceof Error ? parseEnvironmentsErrorMessage(error.message)?.code : undefined;
}

function Spec({ children }: { children: ReactNode }) {
	return <code className="text-foreground font-mono">{children}</code>;
}

function InstallTitle({ request }: { request: PackageInstallRequest }) {
	return (
		<DialogTitle>
			Install <Spec>{request.spec}</Spec>
		</DialogTitle>
	);
}

function CheckingStep({
	request,
	onCancel,
}: {
	request: PackageInstallRequest;
	onCancel: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<InstallTitle request={request} />
				<DialogDescription>
					From <Spec>{request.channel}</Spec>.
				</DialogDescription>
			</DialogHeader>
			<p
				className="text-muted-foreground flex items-center gap-2"
				data-qa-id="environments-install-link-checking"
			>
				<Spinner aria-hidden="true" />
				Checking your conda channels… This waits for any conda task already running.
			</p>
			<DialogFooter>
				<CancelButton onClick={onCancel} />
			</DialogFooter>
		</>
	);
}

function CheckFailedStep({
	request,
	error,
	onRetry,
	onCancel,
}: {
	request: PackageInstallRequest;
	error: unknown;
	onRetry: () => void;
	onCancel: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<InstallTitle request={request} />
				<DialogDescription>
					From <Spec>{request.channel}</Spec>.
				</DialogDescription>
			</DialogHeader>
			<FieldError data-qa-id="environments-install-link-error">
				{friendlyEnvironmentsError(error, "Could not check your conda channels.")}
			</FieldError>
			<DialogFooter>
				<CancelButton onClick={onCancel} />
				<Button type="button" onClick={onRetry} data-qa-id="environments-install-link-retry">
					Retry
				</Button>
			</DialogFooter>
		</>
	);
}

function ChannelStep({
	request,
	exact,
	adding,
	addError,
	onInstallOnce,
	onAddAndInstall,
	onCancel,
}: {
	request: PackageInstallRequest;
	/** False when an older conda bridge could only compare channel names. */
	exact: boolean;
	adding: boolean;
	addError: Error | null;
	onInstallOnce: () => void;
	onAddAndInstall: () => void;
	onCancel: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Channel not configured</DialogTitle>
				<DialogDescription data-qa-id="environments-install-link-channel-description">
					<Spec>{request.spec}</Spec> is from <Spec>{request.channel}</Spec>,{" "}
					{exact
						? "which is not one of your conda channels."
						: "which does not match any of your conda channels by name."}
				</DialogDescription>
			</DialogHeader>
			<Alert data-qa-id="environments-install-link-channel-warning">
				<ShieldAlertIcon aria-hidden="true" />
				<AlertDescription>
					Packages can run scripts on your computer while they install. Only install from channels
					you trust. Install once uses the channel for this install only; Add &amp; install also
					adds it to your conda channels.
				</AlertDescription>
			</Alert>
			{addError ? (
				<FieldError data-qa-id="environments-install-link-add-error">
					{friendlyEnvironmentsError(addError, "Could not add the channel.")}
				</FieldError>
			) : null}
			<DialogFooter>
				<CancelButton onClick={onCancel} />
				<Button
					type="button"
					variant="outline"
					disabled={adding}
					onClick={onAddAndInstall}
					data-qa-id="environments-install-link-add-channel"
				>
					{adding ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
					Add &amp; install
				</Button>
				{/* The default: a channel from a web page is used for this install only,
				    unless the person chooses to keep it. */}
				<Button
					type="button"
					autoFocus
					disabled={adding}
					onClick={onInstallOnce}
					data-qa-id="environments-install-link-install-once"
				>
					Install once
				</Button>
			</DialogFooter>
		</>
	);
}

function TargetStep({
	request,
	onChooseEnvironment,
	onChooseNew,
	onCancel,
}: {
	request: PackageInstallRequest;
	onChooseEnvironment: (env: CondaEnv) => void;
	/** Opens Create environment with the suggested name. */
	onChooseNew: (name: string) => void;
	onCancel: () => void;
}) {
	const conda = useConda();
	const envs = useCondaQuery(conda, "listEnvironments");
	const [query, setQuery] = useState("");
	const newEnvironmentDescriptionId = useId();
	const existingHeadingId = useId();
	const suggestedName = suggestEnvironmentName(request.package, envs.data ?? []);
	const visible = useMemo(() => {
		const term = query.trim().toLowerCase();
		const rows = envs.data ?? [];
		const matches = term
			? rows.filter(
					(env) =>
						environmentDisplayName(env).toLowerCase().includes(term) ||
						env.prefix.toLowerCase().includes(term),
				)
			: rows;
		return matches.toSorted((a, b) =>
			environmentDisplayName(a).localeCompare(environmentDisplayName(b)),
		);
	}, [envs.data, query]);

	return (
		<>
			<DialogHeader>
				<InstallTitle request={request} />
				<DialogDescription>
					{request.channel ? (
						<>
							From <Spec>{request.channel}</Spec>.{" "}
						</>
					) : null}
					Install it into a new environment or one you already have.
				</DialogDescription>
			</DialogHeader>
			<div className="border-border hover:bg-muted rounded-lg border transition-colors">
				<SummaryCard.Row>
					<SummaryCard.Button
						onClick={() => onChooseNew(suggestedName)}
						aria-label="Create new environment"
						aria-describedby={newEnvironmentDescriptionId}
						data-qa-id="environments-install-link-new-env"
					>
						<SummaryCard.Icon>
							<PlusIcon aria-hidden="true" />
						</SummaryCard.Icon>
						<SummaryCard.Content>
							<SummaryCard.Title>Create new environment</SummaryCard.Title>
							<SummaryCard.Description id={newEnvironmentDescriptionId}>
								Named <Spec>{suggestedName}</Spec>; you can rename it before it is created.
							</SummaryCard.Description>
						</SummaryCard.Content>
					</SummaryCard.Button>
				</SummaryCard.Row>
			</div>
			<p id={existingHeadingId} className="text-muted-foreground -mb-1 text-xs font-medium">
				Existing environments
			</p>
			<InputGroup>
				<InputGroupInput
					type="search"
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
					placeholder="Search environments"
					aria-label="Search environments"
					data-qa-id="environments-install-link-search"
				/>
				<InputGroupAddon>
					<SearchIcon aria-hidden="true" />
				</InputGroupAddon>
			</InputGroup>
			<ul
				className="border-border divide-border max-h-72 min-w-0 divide-y overflow-y-auto rounded-lg border"
				aria-labelledby={existingHeadingId}
			>
				{envs.isPending ? (
					<li
						className="text-muted-foreground flex items-center gap-2 px-3 py-2.5"
						data-qa-id="environments-install-link-envs-loading"
					>
						<Spinner aria-hidden="true" />
						Loading environments…
					</li>
				) : envs.isError ? (
					<li className="px-3 py-2.5">
						<FieldError data-qa-id="environments-install-link-envs-error">
							{friendlyEnvironmentsError(envs.error, "Could not load environments.")}
						</FieldError>
					</li>
				) : query.trim() && visible.length === 0 ? (
					<li
						className="text-muted-foreground flex items-center gap-2 px-3 py-2.5"
						data-qa-id="environments-install-link-empty"
					>
						<SearchXIcon className="size-3.5" aria-hidden="true" />
						No environments match “{query.trim()}”.
					</li>
				) : (
					visible.map((env) => (
						<li key={env.prefix} className="hover:bg-muted transition-colors">
							<SummaryCard.Row>
								<SummaryCard.Button
									onClick={() => onChooseEnvironment(env)}
									aria-label={`Install into ${environmentDisplayName(env)}`}
									data-qa-id="environments-install-link-env"
								>
									<SummaryCard.Icon>
										<BoxIcon aria-hidden="true" />
									</SummaryCard.Icon>
									<SummaryCard.Content>
										<SummaryCard.Title>{environmentDisplayName(env)}</SummaryCard.Title>
										<SummaryCard.Description>{env.prefix}</SummaryCard.Description>
									</SummaryCard.Content>
								</SummaryCard.Button>
							</SummaryCard.Row>
						</li>
					))
				)}
			</ul>
			<DialogFooter>
				<CancelButton onClick={onCancel} />
			</DialogFooter>
		</>
	);
}

function CancelButton({ onClick }: { onClick: () => void }) {
	return (
		<Button
			type="button"
			variant="outline"
			onClick={onClick}
			data-qa-id="environments-install-link-cancel"
		>
			Cancel
		</Button>
	);
}
