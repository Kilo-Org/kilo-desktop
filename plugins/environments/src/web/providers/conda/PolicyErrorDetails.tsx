import { useState } from "react";

import { LogInIcon } from "lucide-react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	AnacondaAccount,
	type AnacondaAccountResult,
} from "@kilo-desktop/plugin-anaconda/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type {
	EnvironmentsErrorCode,
	PolicyBlockedPackage,
	PolicyNotice,
} from "../../../contracts/common";
import { keyedBlockedPackages } from "./environments-error-message";

/** Shown for a solve failure the bridge flagged with `policy_note`. */
export const POLICY_NOTE_MESSAGE =
	"Your organization's package policy may have removed a package this change depends on.";

export interface PolicyErrorDetailsProps {
	/** The failure's code (from `parseEnvironmentsErrorMessage` or `friendlyEnvironmentsError`). */
	code: EnvironmentsErrorCode | null;
	policy?: PolicyNotice | undefined;
	/** Called after a successful Anaconda sign-in, e.g. to run the failed request again. */
	onSignedIn?: () => void;
	className?: string;
}

/**
 * What a package-policy or Anaconda sign-in failure needs beyond its message:
 * each blocked package with its policy, org and the platform's reason
 * (verbatim), the policy note of a solve failure, and for NOT_SIGNED_IN /
 * CHANNEL_ACCESS_DENIED a "Sign in to Anaconda" action through
 * `kilo.anaconda/account` (hidden without kilo.anaconda). Renders nothing for
 * other failures.
 */
export function PolicyErrorDetails({
	code,
	policy,
	onSignedIn,
	className,
}: PolicyErrorDetailsProps) {
	const blocked = policy?.blocked ?? [];
	const policyNote = policy?.policyNote === true;
	const needsSignIn = code === "NOT_SIGNED_IN" || code === "CHANNEL_ACCESS_DENIED";
	if (blocked.length === 0 && !policyNote && !needsSignIn) return null;
	return (
		<div className={cn("flex flex-col gap-2", className)} data-qa-id="environments-policy-details">
			{blocked.length > 0 ? <BlockedPackages blocked={blocked} /> : null}
			{policyNote ? <p data-qa-id="environments-policy-note">{POLICY_NOTE_MESSAGE}</p> : null}
			{needsSignIn ? <AnacondaSignIn {...(onSignedIn ? { onSignedIn } : {})} /> : null}
		</div>
	);
}

function BlockedPackages({ blocked }: { blocked: readonly PolicyBlockedPackage[] }) {
	return (
		<ul className="flex flex-col gap-1.5" data-qa-id="environments-policy-blocked">
			{keyedBlockedPackages(blocked).map(({ key, entry }) => (
				<li key={key} className="flex flex-col" data-qa-id="environments-policy-blocked-package">
					<span className="text-foreground font-medium">
						{entry.version ? `${entry.package} ${entry.version}` : entry.package}
					</span>
					<span>{blockedBy(entry)}</span>
					{entry.reason ? <span>Reason: {entry.reason}</span> : null}
				</li>
			))}
		</ul>
	);
}

function blockedBy({ policy, org }: PolicyBlockedPackage): string {
	const by = policy ? `Blocked by the policy “${policy}”` : "Blocked by a package policy";
	return org ? `${by} in ${org}` : by;
}

const selectSigningIn = (state: { signingIn: boolean }) => state.signingIn;

export type AnacondaSignInOutcome =
	| { status: "signed-in" }
	| { status: "failed"; reason: string }
	| null;

export interface AnacondaSignInState {
	/** False without kilo.anaconda: there is no sign-in to offer. */
	available: boolean;
	signingIn: boolean;
	/** The last attempt's outcome; null before one and after a cancelled one. */
	outcome: AnacondaSignInOutcome;
	signIn: () => void;
}

/**
 * Anaconda sign-in through `kilo.anaconda/account`, for a surface that draws
 * its own button: whether it is offered, whether it is running, and how the
 * last attempt ended. A cancelled browser sign-in is not a failure.
 */
export function useAnacondaSignIn(onSignedIn?: () => void): AnacondaSignInState {
	const account = useDomainObject(AnacondaAccount);
	const signingIn = useDomainObjectState(AnacondaAccount, selectSigningIn) ?? false;
	const [outcome, setOutcome] = useState<AnacondaSignInOutcome>(null);

	const signIn = async () => {
		if (!account) return;
		setOutcome(null);
		const result: AnacondaAccountResult = await account.methods
			.signIn(undefined)
			.catch((cause: unknown) => ({
				ok: false as const,
				reason: cause instanceof Error ? cause.message : String(cause),
			}));
		if (result.ok) {
			setOutcome({ status: "signed-in" });
			onSignedIn?.();
		} else if (!result.cancelled) {
			setOutcome({ status: "failed", reason: result.reason });
		}
	};

	return { available: account !== null, signingIn, outcome, signIn: () => void signIn() };
}

/** The "Sign in to Anaconda" button's icon: a spinner while the sign-in runs. */
export function AnacondaSignInIcon({ signingIn }: { signingIn: boolean }) {
	return signingIn ? (
		<Spinner data-icon="inline-start" aria-hidden="true" />
	) : (
		<LogInIcon data-icon="inline-start" aria-hidden="true" />
	);
}

function AnacondaSignIn({ onSignedIn }: { onSignedIn?: () => void }) {
	const { available, signingIn, outcome, signIn } = useAnacondaSignIn(onSignedIn);
	if (!available) return null;

	return (
		<div className="flex flex-col items-start gap-1.5">
			<Button
				type="button"
				variant="outline"
				size="xs"
				disabled={signingIn}
				onClick={signIn}
				data-qa-id="environments-anaconda-sign-in"
			>
				<AnacondaSignInIcon signingIn={signingIn} />
				Sign in to Anaconda
			</Button>
			{outcome?.status === "signed-in" ? (
				<span data-qa-id="environments-anaconda-signed-in">
					Signed in to Anaconda.{onSignedIn ? "" : " Try again."}
				</span>
			) : null}
			{outcome?.status === "failed" ? (
				<span data-qa-id="environments-anaconda-sign-in-error">
					Could not sign in to Anaconda: {outcome.reason}
				</span>
			) : null}
		</div>
	);
}
