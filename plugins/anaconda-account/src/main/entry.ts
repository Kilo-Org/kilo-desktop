/**
 * kilo.anaconda-account in main: the `kilo.anaconda-account/account` domain
 * object over `AnacondaAccountService`.
 *
 * Ownership and invariants:
 * - The API key lives in the Anaconda keyring (`~/.anaconda/keyring`, the
 *   system keychain's `Anaconda Cloud` service, or `config.toml`), shared with
 *   the Anaconda CLI and conda — origin read and wrote the same entry, so a
 *   preview/stable sign-in carries over with nothing to import. Nothing is kept
 *   in this plugin's storage.
 * - The session is resolved lazily (the first `session()`/`refresh()`), never
 *   at activation, so the app does not call Anaconda for people who never use
 *   it. Every transition is mirrored into state and announced as `changed`.
 * - One browser sign-in runs at a time: later `signIn()` calls reopen the
 *   authorization page and share the first call's result, and `signingIn`
 *   stays true until it ends. A cancel is reported as `cancelled`, not as an
 *   error. A completed sign-in brings the main window back (the flow ends on
 *   a browser page) and is reported once to telemetry, as is a sign-out.
 * - `apiKey()` answers only `ANACONDA_API_KEY_READERS` calling from main; the
 *   key never reaches a renderer, which could claim to be any plugin.
 */
import {
	definePlugin,
	KernelApp,
	KernelError,
	KernelShell,
	KernelWindows,
	mainHost,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";

import {
	ANACONDA_API_KEY_READERS,
	AnacondaAccount,
	type AnacondaAccountResult,
	type AnacondaAccountSession,
} from "../contracts/index.js";
import {
	AnacondaAccountService,
	type AnacondaAccountServiceOptions,
	type AnacondaCredentials,
} from "./AnacondaAccountService.js";
import { AnacondaCredentialStore } from "./credentials/anaconda-credential-store.js";

type SiteCredentials = AnacondaCredentials & Pick<AnacondaCredentialStore, "getSiteDomain">;

export interface AnacondaAccountMainOptions {
	/** The keyring and site config; defaults to the user's Anaconda keyring. */
	readonly credentials?: (context: { userAgent: string }) => SiteCredentials;
	/** The OAuth client id when the site config has none. */
	readonly clientId?: string;
	readonly service?: Pick<
		AnacondaAccountServiceOptions,
		"login" | "createAuthorizeServer" | "exchangeForApiKey"
	>;
}

const ANONYMOUS: AnacondaAccountSession = { status: "anonymous" };
const CANCELLED: AnacondaAccountResult = {
	ok: false,
	reason: "Sign-in was cancelled.",
	cancelled: true,
};

export function createAnacondaAccountMainEntry(
	options: AnacondaAccountMainOptions = {},
): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			const version = sdk.domains.get(KernelApp)?.getState().version ?? "0.0.0";
			const userAgent = `kilo-desktop/${version}`;
			const credentials =
				options.credentials?.({ userAgent }) ??
				new AnacondaCredentialStore({
					userAgent,
					defaultClientId: options.clientId ?? "",
					logger: sdk.logger,
				});
			const service = new AnacondaAccountService({
				credentials,
				fetch: (url, init) => host.net.fetch(url, init),
				openExternal: async (url) =>
					(await sdk.domains.get(KernelShell)?.methods.openExternal({ url })) ?? false,
				logger: sdk.logger,
				...options.service,
			});

			const track = (event: string) =>
				void sdk.domains
					.get(Telemetry)
					?.methods.track({ event, data: {} })
					.catch(() => undefined);

			let signInFlow: Promise<AnacondaAccountResult> | undefined;
			let cancelRequested = false;

			const runSignIn = async (): Promise<AnacondaAccountResult> => {
				const next = await service.login();
				if (cancelRequested) return CANCELLED;
				if (next.status === "error") return { ok: false, reason: next.reason };
				if (next.status !== "authenticated") {
					return { ok: false, reason: "Anaconda sign-in did not complete." };
				}
				track("Anaconda Logged In");
				void sdk.domains
					.get(KernelWindows)
					?.methods.focusMain(undefined)
					.catch(() => undefined);
				return { ok: true };
			};

			const signIn = (): Promise<AnacondaAccountResult> => {
				if (signInFlow) {
					void service.login();
					return signInFlow;
				}
				cancelRequested = false;
				account.update((state) => ({ ...state, signingIn: true }));
				signInFlow = runSignIn()
					.catch((cause: unknown) => ({ ok: false as const, reason: errorReason(cause) }))
					.finally(() => {
						signInFlow = undefined;
						account.update((state) => ({ ...state, signingIn: false }));
					});
				return signInFlow;
			};

			const signOut = async (): Promise<AnacondaAccountResult> => {
				const next = await service.logout();
				if (next.status === "error") return { ok: false, reason: next.reason };
				track("Anaconda Logged Out");
				return { ok: true };
			};

			const account = sdk.domains.provide(AnacondaAccount, {
				initialState: { session: ANONYMOUS, signingIn: false },
				methods: {
					session: () => service.getSession(),
					refresh: () => service.refresh(),
					signIn: () => signIn(),
					cancelSignIn: () => {
						if (!signInFlow) return;
						cancelRequested = true;
						service.cancelLogin();
					},
					signOut: () => signOut(),
					apiKey: (_input, caller) => {
						if (caller.process !== "main" || !ANACONDA_API_KEY_READERS.includes(caller.pluginId)) {
							throw new KernelError(
								"PERMISSION_DENIED",
								"Only kilo.local-inference, in the main process, can read the Anaconda API key.",
							);
						}
						return credentials.getApiKey();
					},
					siteDomain: () => credentials.getSiteDomain(),
				},
			});

			const stopFollowing = service.onChanged((session) => {
				account.update((state) => ({ ...state, session }));
				account.emit("changed", {});
			});
			sdk.onDispose(() => {
				stopFollowing();
				service.cancelLogin();
				service.dispose();
			});
		},
	});
}

function errorReason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
