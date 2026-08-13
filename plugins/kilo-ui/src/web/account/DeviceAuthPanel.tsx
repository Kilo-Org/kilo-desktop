import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@anaconda-agentic-desktop/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";

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
}: {
	deviceAuth: DeviceAuthState;
	onCancel: () => void;
	onRetry: () => void;
	onOpenBrowser: (url: string) => void;
	onCopy: (text: string) => void;
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
			<Item variant="outline" data-qa-id="kilo-account-device-auth" data-state="initiating">
				<ItemContent className="items-center text-center">
					<Loader2Icon className="text-muted-foreground size-5 animate-spin" />
					<ItemDescription>Starting login…</ItemDescription>
				</ItemContent>
				<ItemActions className="w-full justify-center">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onCancel}
						data-qa-id="kilo-account-cancel"
					>
						Cancel
					</Button>
				</ItemActions>
			</Item>
		);
	}

	if (deviceAuth.status === "error") {
		return (
			<Item variant="outline" data-qa-id="kilo-account-device-auth" data-state="error">
				<ItemContent>
					<ItemTitle>Login failed</ItemTitle>
					{deviceAuth.error ? (
						<FieldError data-qa-id="kilo-account-device-error">{deviceAuth.error}</FieldError>
					) : null}
				</ItemContent>
				<ItemActions className="w-full">
					<Button type="button" onClick={onRetry} data-qa-id="kilo-account-retry">
						Try again
					</Button>
					<Button type="button" variant="ghost" onClick={onCancel} data-qa-id="kilo-account-cancel">
						Cancel
					</Button>
				</ItemActions>
			</Item>
		);
	}

	if (deviceAuth.status === "success") {
		return (
			<Item variant="outline" data-qa-id="kilo-account-device-auth" data-state="success">
				<ItemContent className="items-center text-center">
					<ItemTitle>Login successful</ItemTitle>
				</ItemContent>
			</Item>
		);
	}

	if (deviceAuth.status !== "waiting") return null;

	return (
		<FieldSet data-qa-id="kilo-account-device-auth" data-state="waiting">
			<FieldLegend>Sign in to Kilo</FieldLegend>
			<FieldDescription>
				A browser window should open. If it does not, open the URL below and enter the code.
			</FieldDescription>

			<FieldGroup>
				<Field>
					<FieldTitle>Step 1: Open this URL</FieldTitle>
					{deviceAuth.verificationUrl ? (
						<div className="flex flex-wrap items-center gap-2">
							<code className="bg-muted max-w-full truncate rounded-md px-2 py-1.5 text-xs">
								{deviceAuth.verificationUrl}
							</code>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => onCopy(deviceAuth.verificationUrl!)}
								data-qa-id="kilo-account-copy-url"
							>
								Copy URL
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => onOpenBrowser(deviceAuth.verificationUrl!)}
								data-qa-id="kilo-account-open-browser"
							>
								Open browser
							</Button>
						</div>
					) : null}
				</Field>

				<Field>
					<FieldTitle>Step 2: Enter this code</FieldTitle>
					<Button
						type="button"
						variant="secondary"
						className="h-auto justify-start px-4 py-3 font-mono text-xl tracking-widest"
						title="Click to copy"
						onClick={() => deviceAuth.code && onCopy(deviceAuth.code)}
						data-qa-id="kilo-account-device-code"
					>
						{deviceAuth.code ?? "————"}
					</Button>
				</Field>

				<FieldDescription className="flex items-center gap-2">
					<Loader2Icon className="size-3.5 animate-spin" />
					Waiting for authorization… ({formatTime(remaining)})
				</FieldDescription>

				<div>
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
			</FieldGroup>
		</FieldSet>
	);
}
