import type { ReactNode } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { KiloAccount } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";

/**
 * Page-level gate for a Kilo-gated page (origin's `KiloAuthGate`): a
 * full-page sign-in surface in place of the page until the person is signed
 * in to Kilo, and the page's own loading state while that is not yet known.
 * Without kilo.core's account there is no sign-in to wait for, so the page shows.
 */
export function KiloSignInGate({
	featureName,
	pendingFallback = null,
	children,
}: {
	/** Shown in the sign-in prompt. */
	readonly featureName: string;
	/** Rendered until sign-in is known — pass the page's loading skeleton. */
	readonly pendingFallback?: ReactNode;
	readonly children: ReactNode;
}) {
	const account = useDomainObject(KiloAccount);
	const signedIn = useDomainObjectState(KiloAccount, (state) => state.signedIn);
	const connection = useDomainObjectState(KiloAccount, (state) => state.connection);

	if (!account) return children;

	// Unknown while the Kilo server is still being reached; an unreachable one
	// shows the sign-in surface rather than waiting forever.
	if ((signedIn === null || signedIn === undefined) && connection !== "unavailable") {
		return (
			<div className="contents" aria-busy="true" data-qa-id="kilo-auth-gate-pending">
				{pendingFallback}
			</div>
		);
	}

	if (!signedIn) {
		return (
			<div
				className="flex flex-1 items-center justify-center p-8"
				data-qa-id="kilo-auth-gate-signin"
			>
				<div className="flex max-w-sm flex-col items-center gap-4 text-center">
					<h2 className="text-base font-semibold">Sign in to Kilo</h2>
					<p className="text-muted-foreground text-sm">
						{featureName} requires a Kilo account. Sign in to continue.
					</p>
					<Button
						type="button"
						data-qa-id="kilo-auth-gate-sign-in-button"
						disabled={connection !== "connected"}
						onClick={() => void account.methods.signIn(undefined).catch(() => undefined)}
					>
						Sign in
					</Button>
				</div>
			</div>
		);
	}

	return children;
}
