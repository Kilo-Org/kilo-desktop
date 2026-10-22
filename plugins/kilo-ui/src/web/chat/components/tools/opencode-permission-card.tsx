import { useEffect, useMemo, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
	type OpenCodePermissionRequest,
	type OpenCodePermissionResponse,
	useOpenCodeRuntimeExtras,
} from "@assistant-ui/react-opencode";
import { CircleAlertIcon, ShieldAlertIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import type { SubagentOrigin } from "../../subagents/pending-interactions.js";
import { ComposerShell } from "../composer-shelf.js";
import {
	type CondaInvocationSummary,
	findPermissionToolArgs,
	isPerActionCondaMutation,
	summarizeCondaInvocation,
} from "./conda-tool-invocation.js";
import { describePermissionAction, visiblePermissionPatterns } from "./permission-labels.js";
import { localCondaFileInstallWarning } from "./conda-local-file-warning.js";

export const OpenCodePermissionCard = ({
	request,
	origin,
	acceptOnEnter = true,
}: {
	request: OpenCodePermissionRequest;
	/** Set when a subagent, not the chat's own session, raised the request. */
	origin?: SubagentOrigin | undefined;
	acceptOnEnter?: boolean;
}) => {
	const { replyToPermission } = useOpenCodeRuntimeExtras();
	const [submittingReply, setSubmittingReply] = useState<OpenCodePermissionResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	const submitReply = async (nextReply: OpenCodePermissionResponse) => {
		setSubmittingReply(nextReply);
		setError(null);

		try {
			await replyToPermission(request.id, nextReply);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not submit the reply.");
			setSubmittingReply(null);
		}
	};

	useEffect(() => {
		if (!acceptOnEnter) return;
		const acceptOnEnterKey = (event: KeyboardEvent) => {
			if (
				event.key !== "Enter" ||
				event.shiftKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.repeat ||
				event.isComposing ||
				submittingReply !== null
			) {
				return;
			}

			if (
				event.target instanceof Element &&
				event.target.closest(
					'button, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
				)
			) {
				return;
			}

			event.preventDefault();
			void submitReply("once");
		};

		document.addEventListener("keydown", acceptOnEnterKey);
		return () => document.removeEventListener("keydown", acceptOnEnterKey);
	});

	const permissionLabel = request.toolName ?? request.permission;
	// Friendly title wording; the badge and body keep the raw tool name.
	const actionLabel = describePermissionAction(permissionLabel);
	// A bare `*` (a tool-level rule's wildcard) means nothing to the user.
	const patterns = visiblePermissionPatterns(request.patterns);
	// The permission event carries no args, so resolve the tool call from the
	// thread (falling back to adapter-provided input when present).
	const resolvedArgs = useAuiState((state) =>
		findPermissionToolArgs(state.thread.messages, request.tool),
	);
	const summary = useMemo(
		() => summarizeCondaInvocation(permissionLabel, resolvedArgs ?? request.toolInput),
		[permissionLabel, resolvedArgs, request.toolInput],
	);
	// A `bash` request that installs a local conda file is the agent routing
	// around the (gated) conda tools. Surface the guardrail bypass here, at the
	// moment of consent, regardless of how the agent described it.
	const cliBypassWarning = useMemo(
		() =>
			permissionLabel === "bash" ? localCondaFileInstallWarning(patterns.join("\n")) : undefined,
		[permissionLabel, patterns],
	);
	const description = request.metadata["description"];
	// "Always allow" remembers exactly `request.always`; with nothing to remember it would only act as "Allow once".
	const canRemember = request.always.length > 0;
	// A conda mutation is approved one call at a time — whether it is one of the
	// gated MCP tools or a conda-family CLI command the `ask` rules gate. A
	// standing allow would let a later call skip this dialog.
	const perActionOnly = isPerActionCondaMutation(permissionLabel, patterns);
	const requester = origin
		? origin.title
			? `The subagent “${origin.title}” is`
			: "A subagent is"
		: "The agent is";

	return (
		<ComposerShell className="text-card-foreground gap-4 p-4">
			<div className="flex flex-col gap-4">
				<div className="flex min-h-[1lh] items-center justify-between gap-3">
					<div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
						<ShieldAlertIcon className="text-warning size-3.5" />
						<span className="truncate">
							{origin ? "Subagent permission request" : "Permission request"}
						</span>
					</div>
					<Badge variant="outline">{permissionLabel}</Badge>
				</div>
				<div className="space-y-1.5">
					<h3 className="text-base leading-snug font-medium tracking-tight text-pretty">
						{request.title ?? `Allow ${actionLabel ?? permissionLabel}?`}
					</h3>
					<p className="text-muted-foreground text-sm text-pretty">
						{typeof description === "string"
							? description
							: `${requester} requesting permission to use ${permissionLabel}.`}
					</p>
				</div>
			</div>

			{(patterns.length > 0 || request.toolInput !== undefined) && (
				<div className="grid min-w-0 gap-2">
					{patterns.length > 0 ? (
						<div className="grid min-w-0 gap-2">
							{patterns.map((pattern) => (
								<div
									key={pattern}
									className="border-input dark:bg-input/20 min-w-0 rounded-lg border bg-transparent px-3 py-2.5 text-sm"
								>
									<code className="block truncate font-mono">{pattern}</code>
								</div>
							))}
						</div>
					) : null}
					{request.toolInput !== undefined ? (
						<div className="border-input dark:bg-input/20 min-w-0 rounded-lg border bg-transparent px-3 py-2.5">
							<p className="text-muted-foreground mb-2 text-xs font-medium">Tool input</p>
							<pre className="overflow-x-auto text-xs">
								{JSON.stringify(request.toolInput, null, 2)}
							</pre>
						</div>
					) : null}
				</div>
			)}

			{summary && hasSummaryContent(summary) ? (
				<div className="grid min-w-0 gap-2">
					<div className="border-input dark:bg-input/20 grid min-w-0 gap-1.5 rounded-lg border bg-transparent px-3 py-2.5 text-sm">
						{summary.environment ? (
							<SummaryRow label="Environment" value={summary.environment} />
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
			) : null}

			{cliBypassWarning ? (
				<div className="border-destructive/40 bg-destructive/5 text-destructive flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium">
					<ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
					<span className="min-w-0 break-words">{cliBypassWarning}</span>
				</div>
			) : null}

			<div className="flex flex-col items-center gap-2">
				<div className="flex w-full items-center justify-between gap-2">
					<Button
						variant="ghost"
						onClick={() => void submitReply("reject")}
						disabled={submittingReply !== null}
					>
						{submittingReply === "reject" ? (
							<Spinner data-icon="inline-start" aria-hidden="true" />
						) : null}
						Reject
					</Button>
					<div className="flex items-center gap-2">
						{/* A conda mutation — the gated MCP tools, or a conda-family CLI
						    command the ask rules gate — is approved per action: a
						    standing allow would let a later call (e.g. from a different
						    source) skip this dialog. Only offer it when Kilo has a rule
						    to remember and the request is not per-action-only. */}
						{canRemember && !perActionOnly ? (
							<Button
								variant="outline"
								onClick={() => void submitReply("always")}
								disabled={submittingReply !== null}
							>
								{submittingReply === "always" ? (
									<Spinner data-icon="inline-start" aria-hidden="true" />
								) : null}
								Always allow
							</Button>
						) : null}
						<Button onClick={() => void submitReply("once")} disabled={submittingReply !== null}>
							{submittingReply === "once" ? (
								<Spinner data-icon="inline-start" aria-hidden="true" />
							) : null}
							Allow once
						</Button>
					</div>
				</div>
				{error ? (
					<div className="text-destructive flex min-w-0 items-center gap-2 text-xs">
						<CircleAlertIcon className="size-3.5 shrink-0" />
						<span className="truncate">{error}</span>
					</div>
				) : null}
			</div>
		</ComposerShell>
	);
};

function hasSummaryContent(summary: CondaInvocationSummary): boolean {
	return (
		Boolean(summary.environment) ||
		summary.packages.length > 0 ||
		summary.channels.length > 0 ||
		summary.channelsUnspecified ||
		summary.warnings.length > 0
	);
}

function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 gap-2">
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className="min-w-0 break-words">{value}</span>
		</div>
	);
}
