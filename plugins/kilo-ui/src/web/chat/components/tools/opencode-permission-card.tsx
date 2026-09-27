import { useEffect, useState } from "react";
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
						{request.title ?? `Allow ${permissionLabel}?`}
					</h3>
					<p className="text-muted-foreground text-sm text-pretty">
						{requester} requesting permission to use {permissionLabel}.
					</p>
				</div>
			</div>

			{(request.patterns.length > 0 || request.toolInput !== undefined) && (
				<div className="grid min-w-0 gap-2">
					{request.patterns.length > 0 ? (
						<div className="grid min-w-0 gap-2">
							{request.patterns.map((pattern) => (
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
