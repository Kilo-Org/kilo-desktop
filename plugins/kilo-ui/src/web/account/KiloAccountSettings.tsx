import { useMemo } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLegend,
	FieldSet,
} from "@anaconda-agentic-desktop/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemHeader,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { DeviceAuthPanel } from "./DeviceAuthPanel.js";
import { useKiloAuth } from "./KiloAuthContext.js";
import {
	buildOrgOptions,
	formatBalance,
	formatPassShort,
	isPersonalAccount,
	KILO_CREDITS_URL,
	KILO_PASS_URL,
	KILO_PROFILE_URL,
	organizationIdFromValue,
	passUsagePercent,
	PERSONAL_ORG_VALUE,
	resolveCurrentOrgValue,
} from "./kilo-auth.js";

/**
 * Settings section: Kilo Gateway account — device OAuth login, profile, org,
 * balance / Kilo Pass, and logout. Contributed at `/settings/kilo-account`.
 */
export function KiloAccountSettings() {
	const sdk = useSdk("kilo-ui");
	const auth = useKiloAuth();

	const orgOptions = useMemo(
		() => (auth.profile ? buildOrgOptions(auth.profile.profile) : []),
		[auth.profile],
	);
	const currentOrgValue = useMemo(
		() => (auth.profile ? resolveCurrentOrgValue(auth.profile, orgOptions) : undefined),
		[auth.profile, orgOptions],
	);

	const copyText = (text: string) => {
		void sdk.shell.copyText(text);
	};

	if (auth.connectionUnavailable) {
		return (
			<div
				className="mx-auto w-full max-w-2xl"
				data-qa-id="kilo-account-settings"
				data-state="unavailable"
			>
				<h1 className="text-xl font-semibold tracking-tight" data-qa-id="settings-section-heading">
					Kilo
				</h1>
				<FieldDescription className="mt-1" data-qa-id="kilo-account-unavailable">
					Kilo account sign-in requires the desktop app. Run Anaconda Agentic Desktop to
					authenticate with Kilo Gateway.
				</FieldDescription>
			</div>
		);
	}

	if (auth.isLoading) {
		return (
			<div
				className="mx-auto w-full max-w-2xl"
				data-qa-id="kilo-account-settings"
				data-state="loading"
			>
				<h1 className="text-xl font-semibold tracking-tight" data-qa-id="settings-section-heading">
					Kilo
				</h1>
				<div className="mt-6 flex flex-col gap-3">
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-20 w-full rounded-lg" />
				</div>
			</div>
		);
	}

	const showDeviceAuth = auth.deviceAuth.status !== "idle";
	const signedIn = auth.authenticated === true && auth.profile;

	return (
		<div
			className="mx-auto w-full max-w-2xl"
			data-qa-id="kilo-account-settings"
			data-state={signedIn ? "signed-in" : "signed-out"}
		>
			<h1 className="text-xl font-semibold tracking-tight" data-qa-id="settings-section-heading">
				Kilo
			</h1>
			<FieldDescription className="mt-1">
				Sign in to Kilo Gateway for models, credits, and organization settings.
			</FieldDescription>

			<div className="mt-6 flex flex-col gap-6">
				{showDeviceAuth ? (
					<DeviceAuthPanel
						deviceAuth={auth.deviceAuth}
						onCancel={auth.cancelLogin}
						onRetry={auth.login}
						onOpenBrowser={auth.openExternal}
						onCopy={copyText}
					/>
				) : null}

				{!showDeviceAuth && !signedIn ? (
					<Item
						variant="outline"
						className="flex-col items-start"
						data-qa-id="kilo-account-signed-out"
					>
						<ItemContent>
							<ItemTitle>Not signed in</ItemTitle>
							<ItemDescription>
								Log in to use Kilo Gateway models and manage your credits from this app.
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button type="button" onClick={auth.login} data-qa-id="kilo-account-login">
								Log in with Kilo
							</Button>
						</ItemActions>
					</Item>
				) : null}

				{signedIn && auth.profile ? (
					<FieldGroup>
						<ItemGroup>
							<Item variant="outline">
								<ItemContent>
									<ItemTitle data-qa-id="kilo-account-name">
										{auth.profile.profile.name || auth.profile.profile.email}
									</ItemTitle>
									<ItemDescription data-qa-id="kilo-account-email">
										{auth.profile.profile.email}
									</ItemDescription>
								</ItemContent>
							</Item>

							{orgOptions.length > 0 ? (
								<FieldSet>
									<FieldLegend variant="label">Account</FieldLegend>
									<FieldDescription>Choose a personal account or organization.</FieldDescription>
									<Field>
										<Select
											items={orgOptions.map((o) => ({ value: o.value, label: o.label }))}
											value={currentOrgValue}
											disabled={auth.isSwitchingOrg}
											onValueChange={(next) => {
												if (next == null) return;
												const id = organizationIdFromValue(next);
												const current =
													currentOrgValue === PERSONAL_ORG_VALUE ? null : (currentOrgValue ?? null);
												if (id === current) return;
												auth.setOrganization(id);
											}}
										>
											<SelectTrigger
												aria-label="Organization"
												data-qa-id="kilo-account-org"
												className="w-full"
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													{orgOptions.map((option) => (
														<SelectItem key={option.value} value={option.value}>
															{option.label}
															{option.description ? (
																<span className="text-muted-foreground ml-2 text-xs">
																	{option.description}
																</span>
															) : null}
														</SelectItem>
													))}
												</SelectGroup>
											</SelectContent>
										</Select>
									</Field>
								</FieldSet>
							) : null}

							{auth.profile.balance ? (
								<Item variant="outline" data-qa-id="kilo-account-balance">
									<ItemHeader>
										<ItemContent>
											<ItemDescription>Balance</ItemDescription>
											<ItemTitle
												className="text-lg font-semibold"
												data-qa-id="kilo-account-balance-value"
											>
												{formatBalance(auth.profile.balance.balance)}
											</ItemTitle>
										</ItemContent>
										<ItemActions>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												disabled={auth.isRefreshing}
												onClick={auth.refreshProfile}
												data-qa-id="kilo-account-refresh"
											>
												<RefreshCwIcon data-icon="inline-start" />
												Refresh
											</Button>
										</ItemActions>
									</ItemHeader>

									{isPersonalAccount(auth.profile) && auth.profile.kiloPass ? (
										<>
											<Separator />
											<ItemContent className="basis-full gap-1.5">
												<div className="flex items-baseline justify-between text-sm">
													<span className="font-medium">Kilo Pass</span>
													<span
														className="text-muted-foreground"
														data-qa-id="kilo-account-pass-usage"
													>
														{formatPassShort(auth.profile.kiloPass.currentPeriodUsageUsd)} /{" "}
														{formatPassShort(auth.profile.kiloPass.currentPeriodBaseCreditsUsd)}
													</span>
												</div>
												<div className="bg-muted h-1.5 overflow-hidden rounded-full">
													<div
														className="bg-primary h-full rounded-full transition-[width]"
														style={{
															width: `${passUsagePercent(
																auth.profile.kiloPass.currentPeriodUsageUsd,
																auth.profile.kiloPass.currentPeriodBaseCreditsUsd,
															)}%`,
														}}
														data-qa-id="kilo-account-pass-bar"
													/>
												</div>
												{auth.profile.kiloPass.currentPeriodBonusCreditsUsd > 0 ? (
													<div className="text-muted-foreground flex justify-between text-xs">
														<span>Bonus</span>
														<span>
															+{formatBalance(auth.profile.kiloPass.currentPeriodBonusCreditsUsd)}
														</span>
													</div>
												) : null}
											</ItemContent>
										</>
									) : null}

									{isPersonalAccount(auth.profile) && !auth.profile.kiloPass ? (
										<>
											<Separator />
											<ItemActions className="basis-full justify-start">
												<Button
													type="button"
													variant="link"
													className="h-auto px-0"
													onClick={() => auth.openExternal(KILO_PASS_URL)}
													data-qa-id="kilo-account-get-pass"
												>
													Get Kilo Pass
												</Button>
											</ItemActions>
										</>
									) : null}
								</Item>
							) : null}
						</ItemGroup>

						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								className="flex-1"
								onClick={() => auth.openExternal(KILO_PROFILE_URL)}
								data-qa-id="kilo-account-dashboard"
							>
								Dashboard
							</Button>
							<Button
								type="button"
								variant="outline"
								className="flex-1"
								onClick={() => auth.openExternal(KILO_CREDITS_URL)}
								data-qa-id="kilo-account-top-up"
							>
								Top up
							</Button>
							<Button
								type="button"
								variant="destructive"
								className="flex-1"
								onClick={auth.logout}
								data-qa-id="kilo-account-logout"
							>
								Log out
							</Button>
						</div>
					</FieldGroup>
				) : null}
			</div>
		</div>
	);
}
