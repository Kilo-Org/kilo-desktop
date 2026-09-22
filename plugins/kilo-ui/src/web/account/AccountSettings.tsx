import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { LogInIcon, LogOutIcon } from "lucide-react";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";
import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { AnacondaLogo } from "@kilo-desktop/ui/components/anaconda-logo";

import { ProviderIcon } from "../chat/model-selection/provider-icon.js";
import { KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel.js";
import { useKiloAuth } from "./KiloAuthContext.js";

/**
 * Account settings: Kilo and Anaconda sign-in status with sign-out controls.
 * Rows follow the AI Providers page hierarchy (SummaryCard rows in bordered
 * cards) so account management reads the same as the rest of Settings. Kilo
 * state comes from the KiloAuthProvider; Anaconda state from the shell's
 * `sdk.auth` delegate.
 */
export function AccountSettings() {
	const auth = useKiloAuth();
	const sdk = useSdk("kilo-ui");
	const { resolving } = useAnacondaSession(sdk);
	const kiloLoading = auth.isLoading && auth.deviceAuth.status === "idle";
	const loading = kiloLoading || resolving;

	return (
		<div
			className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6"
			data-qa-id="account-page"
			data-state={loading ? "loading" : "ready"}
		>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1
						className="text-base font-semibold tracking-tight"
						data-qa-id="settings-section-heading"
					>
						Account
					</h1>
					<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
						See where you are signed in and manage your accounts.
					</p>
				</div>
			</header>

			<section
				className="flex min-w-0 flex-col gap-2"
				aria-label="Accounts"
				data-qa-id="account-rows"
			>
				<AccountEntrySurface>
					{kiloLoading ? <KiloRowLoading /> : <AccountKiloRow />}
				</AccountEntrySurface>
				<AccountEntrySurface>
					{resolving ? <AnacondaRowLoading /> : <AccountAnacondaRow />}
				</AccountEntrySurface>
			</section>
		</div>
	);
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function AccountEntrySurface({ children }: { children: ReactNode }) {
	return (
		<div className="border-border bg-card min-w-0 overflow-hidden rounded-lg border">
			{children}
		</div>
	);
}

function AccountKiloRow() {
	const auth = useKiloAuth();
	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const signedIn = auth.authenticated === true && Boolean(auth.profile);
	const profileFailed = auth.authenticated === true && !auth.profile && Boolean(auth.profileError);
	const showAccountDetails = signedIn || showDeviceAuth || profileFailed;
	const email = auth.profile?.profile.email;

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
							Sign Out
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
							Sign In
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
				toast.error("Sign-out failed", { description: next.reason });
				return;
			}
			void sdk.telemetry.track({ event: "LOGGED_OUT" });
		} catch (cause) {
			toast.error("Sign-out failed", { description: errorMessage(cause) });
		}
	};

	// Same flow as the sidebar account dock: the OAuth login leaves the app for
	// the browser (Anaconda sign-in), the loopback completion updates the
	// session, and this row re-renders into its signed-in state.
	const signIn = async (): Promise<void> => {
		try {
			const next = await sdk.auth.login();
			if (next.status === "error") {
				toast.error("Sign-in failed", { description: next.reason });
				return;
			}
			void sdk.telemetry.track({ event: "LOGGED_IN" });
		} catch (cause) {
			toast.error("Sign-in failed", { description: errorMessage(cause) });
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
						Sign Out
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
						Sign In
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

function KiloRowLoading() {
	return (
		<SummaryCard.Row data-qa-id="account-kilo-row" data-state="loading">
			<SummaryCard.Icon>
				<ProviderIcon provider="kilo" variant="color" size={18} fallbackLabel="Kilo" />
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title>Kilo</SummaryCard.Title>
				<Skeleton className="bg-muted-foreground/25 mt-0.5 h-3 w-48" />
			</SummaryCard.Content>
		</SummaryCard.Row>
	);
}

function AnacondaRowLoading() {
	return (
		<SummaryCard.Row data-qa-id="account-anaconda-row" data-state="loading">
			<SummaryCard.Icon>
				<AnacondaLogo className="size-[18px] text-(--color-green-700)" />
			</SummaryCard.Icon>
			<SummaryCard.Content>
				<SummaryCard.Title>Anaconda</SummaryCard.Title>
				<Skeleton className="bg-muted-foreground/25 mt-0.5 h-3 w-48" />
			</SummaryCard.Content>
		</SummaryCard.Row>
	);
}
