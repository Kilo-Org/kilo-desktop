import { CircleAlertIcon, ShieldAlertIcon } from "lucide-react";

import type {
	PermissionDetailProps,
	PermissionInteraction,
	PermissionRendererImplementation,
} from "@kilo-desktop/plugin-chat/contracts";

import {
	isPerActionCondaMutation,
	summarizeCondaInvocation,
	type CondaInvocationSummary,
} from "../../shared/conda-invocation";
import { condaPermissionAction } from "../../shared/conda-permissions";
import { localCondaFileInstallWarning } from "../../shared/local-file-warning";

function hasSummaryContent(summary: CondaInvocationSummary): boolean {
	return (
		Boolean(summary.environment) ||
		Boolean(summary.cloneDestination) ||
		summary.packages.length > 0 ||
		summary.channels.length > 0 ||
		summary.channelsUnspecified ||
		summary.warnings.length > 0
	);
}

function SummaryRow({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="flex min-w-0 gap-2">
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className="min-w-0 break-words">{value}</span>
		</div>
	);
}

/** What a mutating conda tool will run, and from where: its environment, packages, channels and warnings. */
export function CondaInvocationDetail({ request }: PermissionDetailProps) {
	const summary = summarizeCondaInvocation(request.action, request.args);
	if (!summary || !hasSummaryContent(summary)) return null;
	return (
		<div className="grid min-w-0 gap-2" data-qa-id="conda-permission-summary">
			<div className="border-input dark:bg-input/20 grid min-w-0 gap-1.5 rounded-lg border bg-transparent px-3 py-2.5 text-sm">
				{summary.environment ? (
					<SummaryRow
						label={summary.cloneDestination ? "Clone from" : "Environment"}
						value={summary.environment}
					/>
				) : null}
				{summary.cloneDestination ? (
					<SummaryRow label="New environment" value={summary.cloneDestination} />
				) : null}
				{summary.packages.length > 0 ? (
					<SummaryRow label="Packages" value={summary.packages.join(", ")} />
				) : null}
				{summary.channels.length > 0 || summary.channelsUnspecified ? (
					<SummaryRow
						label="Channels"
						value={
							summary.channels.length > 0
								? summary.channels.join(", ")
								: "not specified (uses your configured channels)"
						}
					/>
				) : null}
			</div>
			{summary.warnings.map((warning) => (
				<div key={warning} className="text-warning flex min-w-0 items-center gap-2 text-xs">
					<CircleAlertIcon className="size-3.5 shrink-0" />
					<span className="min-w-0 break-words">{warning}</span>
				</div>
			))}
		</div>
	);
}

/** `conda-cli` applies to every request, so it picks out `shell` itself. */
const isShell = (request: PermissionInteraction) => request.action === "shell";

/**
 * A `shell` request installing a local package file is the agent routing
 * around the gated conda tools: warn at the moment of consent, whatever the
 * agent said.
 */
export function LocalFileInstallDetail({ request }: PermissionDetailProps) {
	if (!isShell(request)) return null;
	const warning = localCondaFileInstallWarning(request.resources.join("\n"));
	if (!warning) return null;
	return (
		<div
			className="border-destructive/40 bg-destructive/5 text-destructive flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium"
			data-qa-id="conda-local-file-warning"
		>
			<ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
			<span className="min-w-0 break-words">{warning}</span>
		</div>
	);
}

/**
 * A conda mutation — a gated tool, or a conda-family command the `shell` ask
 * rules gate — is approved one call at a time: a standing allow would let a
 * later, possibly injection-driven, call skip the prompt.
 */
const perActionOnly = (request: PermissionInteraction) =>
	!isPerActionCondaMutation(request.action, request.resources);

/** The mutating conda tools' permission cards. */
export const condaToolInteractions: PermissionRendererImplementation = {
	permissionTitle: (request) => condaPermissionAction(request.action),
	PermissionDetail: CondaInvocationDetail,
	allowAlways: perActionOnly,
};

/** `shell` permission cards for conda-family commands and local package installs. */
export const condaCliInteractions: PermissionRendererImplementation = {
	PermissionDetail: LocalFileInstallDetail,
	allowAlways: (request) => !isShell(request) || perActionOnly(request),
};

/** Agent questions offering to install a local package file. */
export const localFileAnswerInteractions: PermissionRendererImplementation = {
	optionWarning: (option) =>
		localCondaFileInstallWarning(`${option.label} ${option.description ?? ""}`),
};
