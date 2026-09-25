import { type FormEvent, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AnacondaMcpService, AnacondaMcpStatus } from "@kilo-desktop/contracts";
import { ANACONDA_MCP_STATUS_CHANGED_EVENT } from "@kilo-desktop/contracts";
import {
	sdkQueryKey,
	useFeatureFlag,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@kilo-desktop/sdk-react";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import { Input } from "@kilo-desktop/ui/components/input";
import { Label } from "@kilo-desktop/ui/components/label";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";

// ─── Status chip styling ────────────────────────────────────────────────────────

/**
 * LaunchDarkly feature-flag key that gates this panel and the underlying
 * reconciliation. Kept in sync with `FEATURE_FLAG_KEY` in
 * `apps/desktop/src/main/features/anaconda-mcp/AnacondaMcpService.ts`.
 */
const FEATURE_FLAG_KEY = "remote-anaconda-mcp";

const STATUS_STYLES: Record<
	AnacondaMcpStatus["state"],
	{ label: string; dotClassName: string; pending?: boolean }
> = {
	connected: { label: "Connected", dotClassName: "bg-success" },
	"waiting-for-auth": { label: "Waiting for login", dotClassName: "bg-warning" },
	"waiting-for-kilo": { label: "Starting…", dotClassName: "bg-warning", pending: true },
	disabled: { label: "Disabled", dotClassName: "bg-muted-foreground" },
	error: { label: "Error", dotClassName: "bg-destructive" },
};

function StatusChip({ status }: { status: AnacondaMcpStatus }) {
	const style = STATUS_STYLES[status.state];
	const detail =
		status.state === "connected" ? status.url : status.state === "error" ? status.reason : null;

	return (
		<Badge
			variant="outline"
			data-qa-id="anaconda-mcp-status-chip"
			data-state={status.state}
			className="max-w-full"
		>
			{style.pending ? (
				<Spinner data-icon="inline-start" aria-hidden="true" />
			) : (
				<span className={cn("size-1.5 rounded-full", style.dotClassName)} aria-hidden="true" />
			)}
			{style.label}
			{detail ? <span className="text-muted-foreground max-w-48 truncate">— {detail}</span> : null}
		</Badge>
	);
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function AnacondaMcpSettings() {
	const featureEnabled = useFeatureFlag<boolean>(FEATURE_FLAG_KEY, false);
	const sdk = useSdk<AnacondaMcpService>("anaconda-mcp");
	const queryClient = useQueryClient();

	const statusQuery = useSdkQuery(sdk, "status.get");
	const settingsQuery = useSdkQuery(sdk, "settings.get");
	const setSettings = useSdkMutation(sdk, "settings.set", {
		invalidates: ["settings.get", "status.get"],
	});

	const [showAdvanced, setShowAdvanced] = useState(false);
	const [urlInput, setUrlInput] = useState("");

	// Sync URL input with current settings. Uses `?? ""` so a null override
	// (default or explicit clear) resets the input rather than leaving stale text.
	useEffect(() => {
		setUrlInput(settingsQuery.data?.urlOverride ?? "");
	}, [settingsQuery.data?.urlOverride]);

	// Invalidate queries on status-changed event
	useEffect(() => {
		const unsubscribe = sdk.events.on(ANACONDA_MCP_STATUS_CHANGED_EVENT, () => {
			void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "status.get") });
		});
		return unsubscribe;
	}, [queryClient, sdk]);

	const status = statusQuery.data;
	const settings = settingsQuery.data;
	const isEnabled = settings?.enabled ?? true;

	function handleToggle() {
		setSettings.mutate({ enabled: !isEnabled });
	}

	function handleUrlSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = urlInput.trim();
		setSettings.mutate({ urlOverride: trimmed || null });
	}

	function handleUrlClear() {
		setUrlInput("");
		setSettings.mutate({ urlOverride: null });
	}

	if (!featureEnabled) {
		return (
			<div className="mx-auto max-w-3xl" data-qa-id="anaconda-mcp-settings" data-state="flag-off">
				<h1 className="text-base font-semibold tracking-tight">Anaconda MCP</h1>
				<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
					This feature is not enabled for your account. Contact your Anaconda administrator or try
					again later.
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-3xl" data-qa-id="anaconda-mcp-settings">
			<h1 className="text-base font-semibold tracking-tight">Anaconda MCP</h1>
			<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
				Connects to the Anaconda Remote MCP server to provide package search and organization policy
				tools in Kilo chats.
			</p>

			{/* Status */}
			<div className="mt-6 flex items-center gap-3">
				<span className="text-sm font-medium">Status:</span>
				{statusQuery.isPending ? (
					<span role="status" aria-busy="true" aria-label="Loading status">
						<Skeleton className="h-5 w-24 rounded-4xl" aria-hidden="true" />
					</span>
				) : statusQuery.isError ? (
					<span className="text-destructive text-xs">Could not load status</span>
				) : status ? (
					<StatusChip status={status} />
				) : null}
			</div>

			{/* Enable/Disable toggle */}
			<div className="mt-6">
				<Label className="flex items-center gap-3">
					<Checkbox
						data-qa-id="anaconda-mcp-toggle"
						checked={isEnabled}
						disabled={setSettings.isPending || settingsQuery.isPending || settingsQuery.isError}
						onCheckedChange={handleToggle}
					/>
					<span className="text-sm">Enable Anaconda MCP</span>
				</Label>
				{settingsQuery.isError ? (
					<p className="text-destructive mt-1 ml-7 text-xs" role="alert">
						Could not load the saved setting — the toggle is unavailable until it loads.
					</p>
				) : null}
				<p className="text-muted-foreground mt-1 ml-7 text-xs">
					When enabled, Anaconda tools are automatically available in Kilo chats while logged in.
					Kilo Desktop provides the <code>anaconda-remote</code> MCP server to its embedded Kilo
					only — the Kilo CLI and other Kilo installs are not affected. Use this toggle to opt out.
				</p>
			</div>

			{/* Mutation error */}
			{setSettings.isError ? (
				<p className="text-destructive mt-4 text-sm" role="alert">
					Could not update settings: {setSettings.error.message}
				</p>
			) : null}

			{/* Advanced section */}
			<div className="mt-8 border-t pt-6">
				<button
					type="button"
					data-qa-id="anaconda-mcp-advanced-toggle"
					className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm font-medium transition-colors"
					aria-expanded={showAdvanced}
					onClick={() => setShowAdvanced(!showAdvanced)}
				>
					<ChevronDownIcon
						className={cn("size-3.5 transition-transform", !showAdvanced && "-rotate-90")}
						aria-hidden="true"
					/>
					Advanced
				</button>

				{showAdvanced ? (
					<form className="mt-4 grid gap-3" onSubmit={handleUrlSubmit}>
						<Label htmlFor="anaconda-mcp-url">MCP server URL override</Label>
						<p className="text-muted-foreground text-xs">
							Override the default Anaconda MCP server URL. Leave empty to use the default.
						</p>
						<Input
							id="anaconda-mcp-url"
							data-qa-id="anaconda-mcp-url-input"
							type="url"
							placeholder="https://anaconda.com/api/mcp"
							value={urlInput}
							onChange={(event) => setUrlInput(event.target.value)}
						/>
						<div className="flex gap-2">
							<Button
								type="submit"
								data-qa-id="anaconda-mcp-url-save"
								disabled={setSettings.isPending}
							>
								Save
							</Button>
							<Button
								type="button"
								data-qa-id="anaconda-mcp-url-clear"
								variant="outline"
								disabled={setSettings.isPending || !settings?.urlOverride}
								onClick={handleUrlClear}
							>
								Reset to default
							</Button>
						</div>
					</form>
				) : null}
			</div>
		</div>
	);
}
