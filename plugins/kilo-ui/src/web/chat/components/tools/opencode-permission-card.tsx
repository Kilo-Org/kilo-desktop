import { useState } from "react";
import {
	type OpenCodePermissionRequest,
	type OpenCodePermissionResponse,
	useOpenCodeRuntimeExtras,
} from "@assistant-ui/react-opencode";
import { AlertCircleIcon, LoaderIcon, ShieldAlertIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";

import {
	Badge,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "./interaction-chrome.js";

export const OpenCodePermissionCard = ({ request }: { request: OpenCodePermissionRequest }) => {
	const { replyToPermission } = useOpenCodeRuntimeExtras();
	const [submittingReply, setSubmittingReply] = useState<OpenCodePermissionResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	const submitReply = async (nextReply: OpenCodePermissionResponse) => {
		setSubmittingReply(nextReply);
		setError(null);

		try {
			await replyToPermission(request.id, nextReply);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to submit reply.");
			setSubmittingReply(null);
		}
	};

	const permissionLabel = request.toolName ?? request.permission;

	return (
		<Card>
			<CardHeader className="gap-4">
				<div className="flex min-h-[1lh] items-center justify-between gap-3">
					<div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
						<ShieldAlertIcon className="size-3.5 text-amber-700 dark:text-amber-500" />
						<span className="truncate">Permission request</span>
					</div>
					<Badge variant="outline" className="text-muted-foreground shrink-0">
						{permissionLabel}
					</Badge>
				</div>
				<div className="space-y-1.5">
					<CardTitle className="text-base leading-snug font-medium text-pretty">
						{request.title ?? `Allow ${permissionLabel}?`}
					</CardTitle>
					<CardDescription className="text-sm text-pretty">
						The agent is requesting permission to use {permissionLabel}.
					</CardDescription>
				</div>
			</CardHeader>

			{(request.patterns.length > 0 || request.toolInput !== undefined) && (
				<CardContent className="grid min-w-0 gap-2">
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
				</CardContent>
			)}

			<CardFooter className="flex-col gap-2">
				<div className="flex w-full items-center justify-between gap-2">
					<Button
						variant="ghost"
						onClick={() => void submitReply("reject")}
						disabled={submittingReply !== null}
					>
						{submittingReply === "reject" ? (
							<LoaderIcon className="animate-spin" data-icon="inline-start" />
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
								<LoaderIcon className="animate-spin" data-icon="inline-start" />
							) : null}
							Always allow
						</Button>
						<Button onClick={() => void submitReply("once")} disabled={submittingReply !== null}>
							{submittingReply === "once" ? (
								<LoaderIcon className="animate-spin" data-icon="inline-start" />
							) : null}
							Allow once
						</Button>
					</div>
				</div>
				{error ? (
					<div className="text-destructive-foreground flex min-w-0 items-center gap-2 text-xs">
						<AlertCircleIcon className="size-3.5 shrink-0" />
						<span className="truncate">{error}</span>
					</div>
				) : null}
			</CardFooter>
		</Card>
	);
};
