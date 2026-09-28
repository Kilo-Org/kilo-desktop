import { useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";

import { FeatureSystemContext } from "./SdkProvider.js";

// No-SDK fallbacks (test/browser shells): module-level constants so
// getSnapshot/getServerSnapshot are referentially stable across renders.
const NO_SDK_SUBSCRIBE = () => () => undefined;
const NO_SDK_SESSION: AuthSession = { status: "anonymous" };
const noSdkSession = () => NO_SDK_SESSION;

/**
 * Structural mirror of kilo-ui's sign-in capability (plugins cannot import
 * from each other; the capability registry is typed structurally at runtime).
 * kilo-ui owns the Kilo device-auth flow and exposes it here so gated pages
 * can trigger sign-in from their own surface.
 */
interface KiloSignInCapability extends Record<string, unknown> {
	signIn: {
		signIn(): Promise<boolean>;
	};
}

/**
 * Page-level gate for Kilo-gated features. Renders a full-page sign-in surface
 * in place of the feature until the user is signed in to Kilo — no modal, and
 * no way to reach the feature unsigned (per product review).
 *
 * The gate resolves on the *first fresh read*, not the cached snapshot: a stale
 * `authenticated` peek (e.g. signed out elsewhere since the cache was written)
 * must not flash gated content, so `resolving` starts true regardless and only
 * clears once `sdk.auth.refresh()` settles. Auth state then tracks via the
 * `sdk.auth` subscription, so a later sign-in/out re-evaluates the gate.
 */
export function KiloAuthGate({
	featureId,
	featureName,
	children,
	sdkOverride,
}: {
	/** The gated plugin's own feature id (used for `useSdk`). */
	featureId: string;
	/** Display name shown in the sign-in prompt. */
	featureName: string;
	children: ReactNode;
	/** Test seam: a prebuilt SDK instead of resolving one via `useSdk`. */
	sdkOverride?: SDK;
}) {
	// Resolve the SDK: the override wins (tests); otherwise read the plugin's own
	// SDK from the feature system. Reading the context directly (not useSdk) so
	// the override path never throws "must be used within <SdkProvider>".
	const system = useContext(FeatureSystemContext);
	const sdk = sdkOverride ?? (system ? (system.getSdk(featureId) as SDK) : undefined);
	return (
		<GateBody sdk={sdk} featureName={featureName}>
			{children}
		</GateBody>
	);
}

function GateBody({
	sdk,
	featureName,
	children,
}: {
	sdk: SDK | undefined;
	featureName: string;
	children: ReactNode;
}) {
	// Hooks run unconditionally; a missing SDK (no provider, no override — e.g.
	// browser/test shell) means no auth to gate on, so children render below.
	// The no-SDK fallbacks must be referentially stable — a fresh object/lambda
	// per render is the classic useSyncExternalStore infinite-loop trigger.
	const session = useSyncExternalStore(
		sdk ? sdk.auth.subscribe : NO_SDK_SUBSCRIBE,
		sdk ? sdk.auth.peek : noSdkSession,
		sdk ? sdk.auth.peek : noSdkSession,
	);
	const [resolving, setResolving] = useState(true);

	useEffect(() => {
		if (!sdk) return;
		let cancelled = false;
		// Always refresh on mount: the session is resolved at boot before the
		// kilo-server capability is up, and the cache may be stale by the time
		// this page opens. refresh() re-publishes to the subscription above.
		// Bound the wait: a wedged sidecar must not leave the gate on "Loading…"
		// forever — fall through to the sign-in surface after a short timeout.
		void sdk.auth
			.refresh()
			.catch(() => undefined)
			.then(() => {
				if (!cancelled) setResolving(false);
			});
		const timeout = setTimeout(() => {
			if (!cancelled) setResolving(false);
		}, 5000);
		return () => {
			cancelled = true;
			clearTimeout(timeout);
		};
	}, [sdk]);

	const signInCapability = sdk?.plugins.get<KiloSignInCapability>("kilo-ui")?.signIn;

	// No SDK (browser/test shell) — nothing to gate on.
	if (!sdk) return children;

	if (resolving) {
		return (
			<div
				className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm"
				data-qa-id="kilo-auth-gate-pending"
			>
				Loading…
			</div>
		);
	}

	if (session.status !== "authenticated") {
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
					<button
						type="button"
						data-qa-id="kilo-auth-gate-sign-in-button"
						onClick={() => void signInCapability?.signIn()}
						className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
					>
						Sign in
					</button>
				</div>
			</div>
		);
	}

	return children;
}
