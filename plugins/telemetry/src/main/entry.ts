import {
	definePlugin,
	KernelApp,
	KernelDataCollection,
	KernelService,
	type AnyDomain,
	type DomainHandle,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Identity, KILO_TERMS_URL, Terms } from "@kilo-desktop/plugin-account/contracts";
import { Onboarding } from "@kilo-desktop/plugin-shell/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import { Telemetry, TelemetryEvent, trackInput } from "../contracts";
import type { TelemetryProvider } from "./types";
import { calculatePeriodId, isAnacondaEmployee } from "./utils";

export interface ProviderConfig {
	/** Release environment from `kernel/data-collection`; development never sends. */
	readonly environment: string;
	readonly appVersion: string;
}

export interface TelemetryMainOptions {
	readonly createProvider: (sdk: PluginSdk, config: ProviderConfig) => TelemetryProvider;
	readonly appRunId?: string;
}

/**
 * kilo.telemetry in main. Every event passes two gates: consent
 * (`kernel/data-collection`, read per event so a change applies at once) and
 * declaration (the caller contributed a `telemetry-event` with that name).
 * Failures are logged and swallowed so telemetry never breaks a caller. The
 * PostHog daemon reports "Desktop Initialized" once the window is shown and
 * flushes queued events on quit.
 */
export function createTelemetryMainEntry(options: TelemetryMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const appRunId = options.appRunId ?? crypto.randomUUID();
			const appVersion = sdk.domains.get(KernelApp)?.getState().version ?? "0.0.0";
			const consent = () => sdk.domains.get(KernelDataCollection)?.getState();
			const provider = options.createProvider(sdk, {
				environment: consent()?.environment ?? "development",
				appVersion,
			});
			const declares = (pluginId: string, event: string) =>
				sdk.extensions
					.list(TelemetryEvent)
					.some(
						(contribution) =>
							contribution.pluginId === pluginId && contribution.metadata.name === event,
					);

			const signedInProfile = () => {
				const identity = sdk.domains.get(Identity)?.getState();
				return identity?.authenticated ? identity.profile?.profile : undefined;
			};

			const send = async (event: string, data: Record<string, unknown>) => {
				const state = consent();
				if (!state?.allowed) return;
				const profile = signedInProfile();
				try {
					await provider.track({
						event,
						data,
						installationId: state.installationId,
						appRunId,
						isEmployee: isAnacondaEmployee(profile?.email),
						...(profile ? { email: profile.email, cohortId: calculatePeriodId() } : {}),
					});
				} catch (cause) {
					sdk.logger.error(`Failed to send telemetry event '${event}'`, cause);
				}
			};

			sdk.domains.provide(Telemetry, {
				initialState: {},
				methods: {
					track: async (input, caller) => {
						const { event, data } = trackInput.parse(input);
						if (!declares(caller.pluginId, event)) {
							sdk.logger.warn(
								`Dropped telemetry event '${event}': "${caller.pluginId}" does not declare it.`,
							);
							return;
						}
						await send(event, data);
					},
				},
			});

			reportAppEvents(sdk, (event, data = {}) => void send(event, data));

			sdk.extensions.implement(KernelService, "posthog", {
				start: () => {
					void send("Desktop Initialized", {
						timestamp: Date.now(),
						version: appVersion,
						platform: process.platform,
					});
				},
				stop: () => provider.dispose(),
			});
		},
	});
}

type Report = (event: string, data?: Record<string, unknown>) => void;

/**
 * Turns other plugins' domain events into analytics, so they need not depend
 * on telemetry: the account (sign-in, sign-out, terms), onboarding and
 * workspaces (folder counts only, never names or paths).
 */
function reportAppEvents(sdk: PluginSdk, report: Report): void {
	const on = <TDomain extends AnyDomain>(
		domain: TDomain,
		listen: (handle: DomainHandle<TDomain>) => (() => void)[],
	) => {
		let stops: (() => void)[] = [];
		sdk.domains.track(domain, {
			added: (handle) => (stops = listen(handle)),
			removed: () => {
				for (const stop of stops) stop();
				stops = [];
			},
		});
		sdk.onDispose(() => stops.forEach((stop) => stop()));
	};

	on(Identity, (identity) => [
		identity.on("signed-in", () => report("Logged In")),
		identity.on("signed-out", () => report("Logged Out")),
	]);
	on(Terms, (terms) => {
		const properties = (version: string) => {
			const acceptedAt = terms.getState().acceptedAt;
			return {
				termsVersion: version,
				termsUrl: KILO_TERMS_URL,
				// `$set_once` keeps a person's first acceptance.
				$set_once: {
					...(acceptedAt !== null ? { terms_accepted_at: new Date(acceptedAt).toISOString() } : {}),
					terms_version: version,
				},
			};
		};
		return [
			terms.on("accepted", ({ version }) => report("Terms Accepted", properties(version))),
			terms.on("linked", ({ version }) => report("Terms Acceptance Linked", properties(version))),
		];
	});
	on(Workspaces, (workspaces) => [
		workspaces.on("created", ({ after, source }) =>
			report("Workspace Created", {
				...(source ? { source } : {}),
				folderCount: after?.folders.length ?? 0,
			}),
		),
		workspaces.on("deleted", ({ before }) =>
			report("Workspace Removed", { folderCount: before?.folders.length ?? 0 }),
		),
	]);
	on(Onboarding, (onboarding) => [
		onboarding.on("shown", () => report("Onboarding Shown")),
		onboarding.on("completed", () => report("Onboarding Completed")),
		onboarding.on("skipped", () => report("Onboarding Skipped")),
	]);
}
