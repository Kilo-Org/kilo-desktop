import { useEffect, useState, useSyncExternalStore } from "react";
import { LogInIcon, LogOutIcon } from "lucide-react";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";
import { SettingsPageHeader, useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { AnacondaLogo } from "@kilo-desktop/ui/components/anaconda-logo";

import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { ButtonSkeleton } from "./ButtonSkeleton.js";
import {
	KiloGatewayAccountLoadingState,
	KiloGatewayAccountPanel,
} from "./KiloGatewayAccountPanel.js";
import { useKiloAuth } from "./KiloAuthContext.js";

/**
 * Account settings: Kilo and Anaconda sign-in status with sign-out controls.
 * Rows follow the AI Providers page pattern (SummaryCard rows joined in one
 * bordered panel) so account management reads the same as the rest of Settings. Kilo
 * state comes from the KiloAuthProvider; Anaconda state from the shell's
 * `sdk.auth` delegate.
 */
export function AccountSettings() {
	const auth = useKiloAuth();
	const sdk = useSdk("kilo-ui");
	const { session, resolving } = useAnacondaSession(sdk);
	const kiloLoading = auth.isLoading && auth.deviceAuth.status === "idle" && !auth.profile;
	const loading = kiloLoading || resolving;

	return (
		<div
			className="flex min-w-0 flex-col gap-6"
			data-qa-id="account-page"
			data-state={loading ? "loading" : "ready"}
		>
			<SettingsPageHeader />
			<section
				className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border"
				aria-label="Accounts"
				data-qa-id="account-rows"
			>
				<div>
					<AccountKiloRow />
				</div>
				<div>{resolving ? <AnacondaRowLoading session={session} /> : <AccountAnacondaRow />}</div>
			</section>
		</div>
	);
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function AccountKiloRow() {
	const auth = useKiloAuth();
	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const connected = auth.authenticated === true;
	const signedIn = connected && Boolean(auth.profile);
	const profileFailed = connected && !auth.profile && Boolean(auth.profileError);
	const initialLoading = auth.isLoading && !showDeviceAuth && !auth.profile;
	const showAccountDetails = signedIn || showDeviceAuth || profileFailed;
	const email = auth.profile?.profile.email;

	if (initialLoading) return <KiloRowLoading connected={connected} />;

	return (
		<div
			className="min-w-0"
			data-qa-id="account-kilo-row"
			data-state={showAccountDetails ? "expanded" : "summary"}
		>
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<ProviderIcon provider="kilo" variant="color" size={18} fallbackLabel="Kilo" />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title>Kilo</SummaryCard.Title>
					<SummaryCard.Description
						{...(signedIn && email
							? { "data-qa-id": "account-kilo-email" }
							: { "data-qa-id": "account-kilo-status" })}
					>
						{kiloDescription({
							connectionUnavailable: auth.connectionUnavailable,
							showDeviceAuth,
							signedIn,
							profileFailed,
							email,
						})}
					</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions className="gap-1" data-qa-id="account-kilo-actions">
					{/* Sign-out stays available whenever credentials exist, even when
					    the profile fetch failed — otherwise that state is unrecoverable
					    from this page. */}
					{auth.authenticated === true ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={auth.logout}
							data-qa-id="account-kilo-sign-out"
						>
							<LogOutIcon data-icon="inline-start" />
							Sign out
						</Button>
					) : null}
					{!signedIn && !profileFailed && !showDeviceAuth ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={auth.connectionUnavailable}
							onClick={() => auth.login()}
							data-qa-id="account-kilo-sign-in"
						>
							<LogInIcon data-icon="inline-start" />
							Sign in
						</Button>
					) : null}
				</SummaryCard.Actions>
			</SummaryCard.Row>

			{showAccountDetails ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountPanel showSignOut={false} />
				</div>
			) : null}
		</div>
	);
}

function kiloDescription(input: {
	connectionUnavailable: boolean;
	showDeviceAuth: boolean;
	signedIn: boolean;
	profileFailed: boolean;
	email: string | undefined;
}): string {
	if (input.connectionUnavailable) return "Available in the desktop app.";
	if (input.showDeviceAuth) return "Finish connecting your Kilo account.";
	if (input.profileFailed) return "Your account is connected, but its profile could not be loaded.";
	if (input.signedIn) return `Signed in as ${input.email ?? "your Kilo account"}`;
	return "Not signed in.";
}

function AccountAnacondaRow() {
	const sdk = useSdk("kilo-ui");
	const { session } = useAnacondaSession(sdk);

	const user = session.status === "authenticated" ? session.user : null;
	const email = user?.email ?? user?.username;
	const sessionFailed = session.status === "error";

	const signOut = async (): Promise<void> => {
		try {
			const next = await sdk.auth.logout();
			if (next.status === "error") {
				toast.error("Could not sign out", { description: next.reason });
				return;
			}
			void sdk.telemetry.track({ event: "Logged Out" });
		} catch (cause) {
			toast.error("Could not sign out", { description: errorMessage(cause) });
		}
	};

	// Same flow as the sidebar account dock: the OAuth login leaves the app for
	// the browser (Anaconda sign-in), the loopback completion updates the
	// session, and this row re-renders into its signed-in state.
	const signIn = async (): Promise<void> => {
		try {
			const next = await sdk.auth.login();
			if (next.status === "error") {
				toast.error("Could not sign in", { description: next.reason });
				return;
			}
			void sdk.telemetry.track({ event: "Logged In" });
		} catch (cause) {
			toast.error("Could not sign in", { description: errorMessage(cause) });
		}
	};

	return (
		<SummaryCard.Row data-qa-id="account-anaconda-row">
			<SummaryCard.Icon>
				<AnacondaLogo className="size-[18px] text-(--color-green-700)" />
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title>Anaconda</SummaryCard.Title>
				<SummaryCard.Description
					{...(session.status === "authenticated"
						? { "data-qa-id": "account-anaconda-email" }
						: { "data-qa-id": "account-anaconda-status" })}
				>
					{session.status === "authenticated"
						? `Signed in as ${email ?? "your Anaconda account"}`
						: sessionFailed
							? session.reason
							: "Not signed in."}
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions className="gap-1" data-qa-id="account-anaconda-actions">
				{session.status === "authenticated" ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void signOut()}
						data-qa-id="account-anaconda-sign-out"
					>
						<LogOutIcon data-icon="inline-start" />
						Sign out
					</Button>
				) : null}
				{session.status !== "authenticated" ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void signIn()}
						data-qa-id="account-anaconda-sign-in"
					>
						<LogInIcon data-icon="inline-start" />
						Sign in
					</Button>
				) : null}
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

/**
 * Read the Anaconda session from the shell `sdk.auth` delegate, exposing
 * whether the first (lazily-started) resolve has landed so the page can keep
 * skeletons up instead of flashing "Not signed in."
 */
function useAnacondaSession(sdk: Pick<SDK, "auth">): { session: AuthSession; resolving: boolean } {
	const session = useSyncExternalStore(sdk.auth.subscribe, sdk.auth.peek, sdk.auth.peek);
	const [resolving, setResolving] = useState(true);

	useEffect(() => {
		let cancelled = false;
		const settle = () => {
			if (!cancelled) setResolving(false);
		};
		void sdk.auth.getSession().then(settle, settle);
		return () => {
			cancelled = true;
		};
	}, [sdk]);

	return { session, resolving };
}

/**
 * Mirrors `AccountKiloRow` while auth loads. Once credentials are known to
 * exist, the account details panel is reserved too, so a slow profile fetch
 * doesn't pop ~200px of balance/actions in under the row.
 */
function KiloRowLoading({ connected }: { connected: boolean }) {
	return (
		<div className="min-w-0" data-qa-id="account-kilo-row" data-state="loading" aria-busy="true">
			<SummaryCard.Row>
				<SummaryCard.Icon>
					<ProviderIcon provider="kilo" variant="color" size={18} fallbackLabel="Kilo" />
				</SummaryCard.Icon>
				<SummaryCard.Content>
					<SummaryCard.Title>Kilo</SummaryCard.Title>
					<SummaryCard.Description>
						<SkeletonText className="w-48" />
					</SummaryCard.Description>
				</SummaryCard.Content>
				<SummaryCard.Actions>
					<AccountActionSkeleton signedIn={connected} />
				</SummaryCard.Actions>
			</SummaryCard.Row>
			{connected ? (
				<div className="border-border bg-background/60 border-t p-4">
					<KiloGatewayAccountLoadingState showSignOut={false} />
				</div>
			) : null}
		</div>
	);
}

function AnacondaRowLoading({ session }: { session: AuthSession }) {
	return (
		<SummaryCard.Row data-qa-id="account-anaconda-row" data-state="loading" aria-busy="true">
			<SummaryCard.Icon>
				<AnacondaLogo className="size-[18px] text-(--color-green-700)" />
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title>Anaconda</SummaryCard.Title>
				<SummaryCard.Description>
					<SkeletonText className="w-48" />
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<AccountActionSkeleton signedIn={session.status === "authenticated"} />
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

/** Sized to the Sign in / Sign out button the loaded row will show. */
function AccountActionSkeleton({ signedIn }: { signedIn: boolean }) {
	return signedIn ? (
		<ButtonSkeleton>
			<LogOutIcon data-icon="inline-start" />
			Sign out
		</ButtonSkeleton>
	) : (
		<ButtonSkeleton>
			<LogInIcon data-icon="inline-start" />
			Sign in
		</ButtonSkeleton>
	);
}
