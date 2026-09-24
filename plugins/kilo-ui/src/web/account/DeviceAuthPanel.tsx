import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRightIcon, CircleAlertIcon, CopyIcon, Loader2Icon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

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
				<div className={cn("flex items-center justify-between gap-3", !embedded && "p-4")}>
					<div className="text-muted-foreground flex items-center gap-2 text-sm">
						<Loader2Icon className="text-primary-ink size-4 animate-spin" />
						<span>Contacting Kilo…</span>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onCancel}
						data-qa-id="kilo-account-cancel"
					>
						Cancel
					</Button>
				</div>
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
						<div className="mt-3 flex flex-wrap items-center gap-2">
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
						</div>
					</div>
				</div>
			</Panel>
		);
	}

	if (deviceAuth.status === "finishing") {
		return (
			<Panel state="finishing" embedded={embedded}>
				<div
					className={cn(
						"text-muted-foreground flex items-center gap-2 text-sm",
						!embedded && "p-4",
					)}
				>
					<Loader2Icon className="text-primary-ink size-4 animate-spin" />
					<span>Finishing connection…</span>
				</div>
			</Panel>
		);
	}

	if (deviceAuth.status !== "waiting") return null;

	return (
		<Panel state="waiting" embedded={embedded}>
			<div className={cn("flex flex-col gap-4", !embedded && "p-4")}>
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium">Approve in your browser</p>
					<p className="text-muted-foreground text-sm">
						We opened a browser window for you. If it didn’t open, use the link below and enter this
						code.
					</p>
				</div>

				<div className="border-border bg-muted/40 flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
					<div className="min-w-0">
						<p className="text-muted-foreground text-xs font-medium">Confirmation code</p>
						<code
							className="mt-0.5 block truncate text-xl font-semibold tracking-[0.18em]"
							data-qa-id="kilo-account-device-code"
						>
							{deviceAuth.code ?? "————"}
						</code>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!deviceAuth.code}
						onClick={() => deviceAuth.code && onCopy(deviceAuth.code)}
						data-qa-id="kilo-account-copy-code"
					>
						<CopyIcon data-icon="inline-start" />
						Copy code
					</Button>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs whitespace-nowrap">
						<Loader2Icon className="size-3.5 animate-spin" />
						<span>Waiting for approval</span>
						<span aria-hidden="true">·</span>
						<span className="tabular-nums" aria-label={`${formatTime(remaining)} remaining`}>
							{formatTime(remaining)}
						</span>
					</span>

					<div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap sm:justify-end">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={onCancel}
							data-qa-id="kilo-account-cancel"
						>
							Cancel
						</Button>
						{deviceAuth.verificationUrl ? (
							<>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => onCopy(deviceAuth.verificationUrl!)}
									data-qa-id="kilo-account-copy-url"
								>
									<CopyIcon data-icon="inline-start" />
									Copy link
								</Button>
								<Button
									type="button"
									size="sm"
									onClick={() => onOpenBrowser(deviceAuth.verificationUrl!)}
									data-qa-id="kilo-account-open-browser"
								>
									Open browser
									<ArrowUpRightIcon data-icon="inline-end" />
								</Button>
							</>
						) : null}
					</div>
				</div>
			</div>
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
