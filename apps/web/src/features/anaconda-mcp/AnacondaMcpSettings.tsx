import { type FormEvent, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { AnacondaMcpService, AnacondaMcpStatus } from "@anaconda-agentic-desktop/contracts";
import {
	sdkQueryKey,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@anaconda-agentic-desktop/sdk-react";
import { Checkbox } from "@anaconda-agentic-desktop/ui/components/checkbox";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Label } from "@anaconda-agentic-desktop/ui/components/label";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";

// ─── Status chip styling ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AnacondaMcpStatus["state"], { label: string; className: string }> = {
	connected: {
		label: "Connected",
		className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
	},
	"waiting-for-auth": {
		label: "Waiting for login",
		className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
	},
	"waiting-for-kilo": {
		label: "Starting…",
		className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
	},
	disabled: {
		label: "Disabled",
		className: "bg-muted text-muted-foreground",
	},
	error: {
		label: "Error",
		className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
	},
};

function StatusChip({ status }: { status: AnacondaMcpStatus }) {
	const style = STATUS_STYLES[status.state];
	const detail =
		status.state === "connected" ? status.url : status.state === "error" ? status.reason : null;

	return (
		<span
			data-qa-id="anaconda-mcp-status-chip"
			data-state={status.state}
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}
		>
			{style.label}
			{detail ? <span className="max-w-48 truncate opacity-75">— {detail}</span> : null}
		</span>
	);
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function AnacondaMcpSettings() {
	const sdk = useSdk<AnacondaMcpService>("anaconda-mcp");
	const queryClient = useQueryClient();

	const statusQuery = useSdkQuery(sdk, "status.get");
	const settingsQuery = useSdkQuery(sdk, "settings.get");
	const setSettings = useSdkMutation(sdk, "settings.set", {
		invalidates: ["settings.get", "status.get"],
	});

	const [showAdvanced, setShowAdvanced] = useState(false);
	const [urlInput, setUrlInput] = useState("");

	// Sync URL input with current settings
	useEffect(() => {
		if (settingsQuery.data?.urlOverride) {
			setUrlInput(settingsQuery.data.urlOverride);
		}
	}, [settingsQuery.data?.urlOverride]);

	// Invalidate queries on status-changed event
	useEffect(() => {
		const unsubscribe = sdk.events.on("anaconda-mcp.status-changed", () => {
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

	return (
		<div className="mx-auto max-w-xl px-5 py-8" data-qa-id="anaconda-mcp-settings">
			<h1 className="text-2xl font-semibold tracking-tight">Anaconda MCP</h1>
			<p className="text-muted-foreground mt-1 text-sm">
				Connects to the Anaconda Remote MCP server to provide package search and organization policy
				tools in Kilo chats.
			</p>

			{/* Status */}
			<div className="mt-6 flex items-center gap-3">
				<span className="text-sm font-medium">Status:</span>
				{statusQuery.isPending ? (
					<span className="text-muted-foreground text-xs">Loading…</span>
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
						disabled={setSettings.isPending || settingsQuery.isPending}
						onCheckedChange={handleToggle}
					/>
					<span className="text-sm">Enable Anaconda MCP</span>
				</Label>
				<p className="text-muted-foreground mt-1 ml-7 text-xs">
					When enabled, Anaconda tools are automatically available in Kilo chats while logged in.
				</p>
			</div>

			{/* Mutation error */}
			{setSettings.isError ? (
				<p className="text-destructive mt-4 text-sm" role="alert">
					Failed to update settings: {setSettings.error.message}
				</p>
			) : null}

			{/* Advanced section */}
			<div className="mt-8 border-t pt-6">
				<button
					type="button"
					data-qa-id="anaconda-mcp-advanced-toggle"
					className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
					onClick={() => setShowAdvanced(!showAdvanced)}
				>
					{showAdvanced ? "▾ Advanced" : "▸ Advanced"}
				</button>

				{showAdvanced ? (
					<form className="mt-4 grid gap-3" onSubmit={handleUrlSubmit}>
						<Label htmlFor="anaconda-mcp-url">MCP Server URL Override</Label>
						<p className="text-muted-foreground text-xs">
							Override the default Anaconda MCP server URL. Leave empty to use the default.
						</p>
						<Input
							id="anaconda-mcp-url"
							data-qa-id="anaconda-mcp-url-input"
							type="url"
							placeholder="https://mcp.anaconda.com/mcp"
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
