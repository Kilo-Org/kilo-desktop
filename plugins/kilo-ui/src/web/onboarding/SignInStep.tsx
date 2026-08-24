import { CheckIcon, Loader2Icon } from "lucide-react";

import { DeviceAuthPanel } from "../account/DeviceAuthPanel.js";
import type { KiloAuthContextValue } from "../account/KiloAuthContext.js";
import { KiloSignInCard } from "../account/KiloSignInCard.js";

export function SignInStep({
	auth,
	onCopy,
}: {
	auth: KiloAuthContextValue;
	onCopy: (text: string) => void;
}) {
	if (auth.deviceAuth.status !== "idle") {
		return (
			<DeviceAuthPanel
				deviceAuth={auth.deviceAuth}
				onCancel={auth.cancelLogin}
				onRetry={auth.login}
				onOpenBrowser={auth.openExternal}
				onCopy={onCopy}
			/>
		);
	}

	if (auth.authenticated === null) {
		return (
			<div
				className="border-border bg-card flex items-center gap-3 rounded-xl border px-4 py-3"
				data-qa-id="onboarding-connecting"
			>
				<Loader2Icon className="text-primary size-5 animate-spin" />
				<p className="text-muted-foreground text-sm">Connecting to Kilo…</p>
			</div>
		);
	}

	if (auth.authenticated === true) {
		const name = auth.profile?.profile.name ?? auth.profile?.profile.email ?? "Kilo";
		return (
			<div
				className="border-border bg-card flex items-center gap-3 rounded-xl border px-4 py-3"
				data-qa-id="onboarding-signed-in"
			>
				<div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full">
					<CheckIcon className="size-4" />
				</div>
				<div className="min-w-0">
					<p className="text-sm font-medium">Connected as {name}</p>
					<p className="text-muted-foreground text-sm">Continue to create your first workspace.</p>
				</div>
			</div>
		);
	}

	return <KiloSignInCard onLogin={auth.login} />;
}
