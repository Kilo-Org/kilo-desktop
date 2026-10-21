import { LogInIcon, LogOutIcon } from "lucide-react";

import { useFeatureFlag, useSdk } from "@kilo-desktop/sdk-react";
import { AnacondaLogo } from "@kilo-desktop/ui/components/anaconda-logo";
import { Button } from "@kilo-desktop/ui/components/button";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	ANACONDA_ACCOUNT_FEATURE_ID,
	type AnacondaAccountCapabilities,
	type AnacondaAccountCapability,
	type AnacondaAccountSession,
} from "../contracts/schemas.js";
import { useAnacondaAccount } from "./useAnacondaAccount.js";

/** What an Anaconda account gives you. */
const ANACONDA_ACCOUNT_SUMMARY =
	"Browse and download models from the Anaconda model catalog, and install packages from authenticated channels like main-x.";

/**
 * The Anaconda sign-in is only useful for the model catalog today, so it rolls
 * out (and back) with the catalog's flag.
 */
const MODEL_CATALOG_FEATURE_FLAG = "local-model-catalog";

/**
 * The Anaconda panel on the Account settings page, contributed into kilo-ui's
 * `account-panels` zone. Anaconda is only a credential source for Anaconda
 * services (it stores an API key); it never affects the Kilo account above it.
 */

export function AnacondaAccountRow() {
	const sdk = useSdk(ANACONDA_ACCOUNT_FEATURE_ID);
	const catalogEnabled = useFeatureFlag<boolean>(MODEL_CATALOG_FEATURE_FLAG, false);
	const account = sdk.plugins.get<AnacondaAccountCapabilities>(
		ANACONDA_ACCOUNT_FEATURE_ID,
	)?.account;
	if (!account || !catalogEnabled) return null;
	return <AnacondaAccountRowView account={account} />;
}

function AnacondaAccountRowView({ account }: { account: AnacondaAccountCapability }) {
	const { session, resolving, pending, signIn, cancelSignIn, signOut } =
		useAnacondaAccount(account);

	if (resolving) return <AnacondaRowLoading />;

	// Sign-in leaves the app for the browser; the loopback completion stores the
	// API key and updates the session, re-rendering this row as signed in.
	const handleSignIn = async (): Promise<void> => {
		const result = await signIn();
		if (!result.ok && !result.cancelled) {
			toast.error("Could not sign in to Anaconda", { description: result.reason });
		}
	};
	const handleSignOut = async (): Promise<void> => {
		const result = await signOut();
		if (!result.ok) toast.error("Could not sign out of Anaconda", { description: result.reason });
	};

	return (
		<SummaryCard.Row data-qa-id="account-anaconda-row">
			<AnacondaIcon />
			<SummaryCard.Content>
				<SummaryCard.Title className="w-full min-w-0 gap-1.5">
					<span className="shrink-0">Anaconda</span>
					<span aria-hidden="true" className="text-muted-foreground font-normal">
						·
					</span>
					<span
						className="text-muted-foreground min-w-0 truncate font-normal"
						data-qa-id={
							session.status === "authenticated"
								? "account-anaconda-email"
								: "account-anaconda-status"
						}
					>
						{describe(session)}
					</span>
				</SummaryCard.Title>
				<SummaryCard.Description className="line-clamp-none">
					{ANACONDA_ACCOUNT_SUMMARY}
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions className="gap-1" data-qa-id="account-anaconda-actions">
				{session.status === "authenticated" ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending !== null}
						onClick={() => void handleSignOut()}
						data-qa-id="account-anaconda-sign-out"
					>
						<LogOutIcon data-icon="inline-start" />
						Sign out
					</Button>
				) : (
					<>
						{pending === "sign-in" ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => void cancelSignIn()}
								data-qa-id="account-anaconda-cancel-sign-in"
							>
								Cancel
							</Button>
						) : null}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending !== null}
							onClick={() => void handleSignIn()}
							data-qa-id="account-anaconda-sign-in"
						>
							<LogInIcon data-icon="inline-start" />
							{pending === "sign-in" ? "Waiting for browser…" : "Sign in"}
						</Button>
					</>
				)}
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

function describe(session: AnacondaAccountSession): string {
	if (session.status === "authenticated") {
		const name = session.user.email ?? session.user.username;
		return `Signed in as ${name ?? "your Anaconda account"}`;
	}
	if (session.status === "error") return session.reason;
	return "Not signed in.";
}

function AnacondaIcon() {
	return (
		<SummaryCard.Icon>
			<AnacondaLogo className="size-[18px] text-(--color-green-700)" />
		</SummaryCard.Icon>
	);
}

function AnacondaRowLoading() {
	return (
		<SummaryCard.Row data-qa-id="account-anaconda-row" data-state="loading" aria-busy="true">
			<AnacondaIcon />
			<SummaryCard.Content>
				<SummaryCard.Title className="w-full min-w-0 gap-1.5">
					<span className="shrink-0">Anaconda</span>
					<SkeletonText className="w-40" />
				</SummaryCard.Title>
				<SummaryCard.Description className="line-clamp-none">
					{ANACONDA_ACCOUNT_SUMMARY}
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Skeleton className="h-7 w-20" />
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}
