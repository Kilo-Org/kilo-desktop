import { useEffect, useState, type ReactNode } from "react";
import { CircleAlertIcon, CopyIcon, Loader2Icon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { DeviceAuthState } from "./kilo-auth.js";

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Device-auth waiting / error panel for Kilo Gateway login.
 * Opens the browser automatically via the auth provider; shows the enterable code.
 */
export function DeviceAuthPanel({
	deviceAuth,
	onCancel,
	onRetry,
	onOpenBrowser,
	onCopy,
	embedded = false,
}: {
	deviceAuth: DeviceAuthState;
	onCancel: () => void;
	onRetry: () => void;
	onOpenBrowser: (url: string) => void;
	onCopy: (text: string) => void;
	/** Skip the outer frame when nested inside another bordered card. */
	embedded?: boolean;
}) {
	const expiresIn = deviceAuth.expiresIn ?? 900;
	const [remaining, setRemaining] = useState(expiresIn);

	useEffect(() => {
		if (deviceAuth.status !== "waiting") return;
		setRemaining(expiresIn);
		const started = Date.now();
		const id = window.setInterval(() => {
			const elapsed = Math.floor((Date.now() - started) / 1000);
			setRemaining(Math.max(0, expiresIn - elapsed));
		}, 1000);
		return () => window.clearInterval(id);
	}, [deviceAuth.status, expiresIn]);

	if (deviceAuth.status === "initiating") {
		return (
			<Panel state="initiating" embedded={embedded}>
				<div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
					<Loader2Icon className="text-primary size-5 animate-spin" />
					<p className="text-muted-foreground text-sm">Contacting Kilo…</p>
				</div>
				<PanelFooter>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onCancel}
						data-qa-id="kilo-account-cancel"
					>
						Cancel
					</Button>
				</PanelFooter>
			</Panel>
		);
	}

	if (deviceAuth.status === "error") {
		return (
			<Panel
				state="error"
				embedded={embedded}
				className={embedded ? "bg-destructive/5" : "border-destructive/40 bg-destructive/5"}
			>
				<div className="flex items-start gap-3 p-4">
					<CircleAlertIcon className="text-destructive-foreground mt-0.5 size-4 shrink-0" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium">Sign-in failed</p>
						{deviceAuth.error ? (
							<p
								className="text-muted-foreground mt-1 text-sm break-words"
								data-qa-id="kilo-account-device-error"
							>
								{deviceAuth.error}
							</p>
						) : null}
					</div>
				</div>
				<PanelFooter className="justify-start">
					<Button type="button" size="sm" onClick={onRetry} data-qa-id="kilo-account-retry">
						Try again
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onCancel}
						data-qa-id="kilo-account-cancel"
					>
						Cancel
					</Button>
				</PanelFooter>
			</Panel>
		);
	}

	if (deviceAuth.status === "finishing") {
		return (
			<Panel state="finishing" embedded={embedded}>
				<div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
					<Loader2Icon className="text-primary size-5 animate-spin" />
					<p className="text-muted-foreground text-sm">Finishing connection…</p>
				</div>
			</Panel>
		);
	}

	if (deviceAuth.status !== "waiting") return null;

	return (
		<Panel state="waiting" embedded={embedded}>
			<div className="p-4">
				<p className="text-sm font-medium">Approve connection in your browser</p>
				<p className="text-muted-foreground mt-1 text-sm">
					We opened a browser window for you. If it didn&rsquo;t open, use the link below and enter
					this code.
				</p>

				<button
					type="button"
					title="Click to copy"
					onClick={() => deviceAuth.code && onCopy(deviceAuth.code)}
					data-qa-id="kilo-account-device-code"
					className="group border-border hover:border-primary/60 hover:bg-primary/5 focus-visible:ring-ring/50 mt-4 flex w-full items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-4 transition-colors outline-none focus-visible:ring-3"
				>
					<span className="font-mono text-2xl font-semibold tracking-[0.3em]">
						{deviceAuth.code ?? "————"}
					</span>
					<CopyIcon className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
				</button>

				{deviceAuth.verificationUrl ? (
					<div className="mt-3 flex items-center gap-2">
						<code className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-xs">
							{deviceAuth.verificationUrl}
						</code>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => onCopy(deviceAuth.verificationUrl!)}
							data-qa-id="kilo-account-copy-url"
						>
							Copy
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => onOpenBrowser(deviceAuth.verificationUrl!)}
							data-qa-id="kilo-account-open-browser"
						>
							Open
						</Button>
					</div>
				) : null}
			</div>

			<PanelFooter>
				<span className="text-muted-foreground flex items-center gap-2 text-xs">
					<Loader2Icon className="size-3.5 animate-spin" />
					Waiting for approval… <span className="tabular-nums">{formatTime(remaining)}</span>
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onCancel}
					data-qa-id="kilo-account-cancel"
				>
					Cancel
				</Button>
			</PanelFooter>
		</Panel>
	);
}

function Panel({
	state,
	className,
	embedded = false,
	children,
}: {
	state: string;
	className?: string;
	embedded?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden",
				!embedded && "border-border bg-card rounded-xl border",
				className,
			)}
			data-qa-id="kilo-account-device-auth"
			data-state={state}
		>
			{children}
		</div>
	);
}

function PanelFooter({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div
			className={cn(
				"bg-muted/50 border-border flex items-center justify-between gap-2 border-t px-4 py-2.5",
				className,
			)}
		>
			{children}
		</div>
	);
}
