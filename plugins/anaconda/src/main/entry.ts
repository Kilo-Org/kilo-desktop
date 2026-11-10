/**
 * kilo.anaconda in main: the `kilo.anaconda/account` domain object over
 * `AnacondaAccountService`, and what follows its session — the
 * `kernel/linked-account` `anaconda`, the `anacondaSignedIn` context key and
 * the `kilo.local-inference/model-catalog` `anaconda-models` (Anaconda's
 * model catalog for the Local Model Server).
 *
 * Ownership and invariants:
 * - The API key lives in the Anaconda keyring (`~/.anaconda/keyring`, the
 *   system keychain's `Anaconda Cloud` service, or `config.toml`), shared with
 *   the Anaconda CLI and conda — origin read and wrote the same entry, so a
 *   preview/stable sign-in carries over with nothing to import. Nothing is kept
 *   in this plugin's storage.
 * - The session is resolved lazily (the first `session()`/`refresh()`, or the
 *   catalog's `resolveAccess()` when it is shown), never at activation, so the
 *   app does not call Anaconda for people who never use it. Every transition
 *   is mirrored into state and announced as `changed`.
 * - The entry tracks whether the session has been resolved: the service only
 *   reports changes, and a first resolve to `anonymous` is not one. Until
 *   then the linked account is null, the context key false and the catalog's
 *   access `resolving`; afterwards all three follow every session/key change
 *   (the catalog calls back on the first resolve too, and on every change).
 * - One browser sign-in runs at a time, whether started by the domain object
 *   or the catalog: later `signIn()` calls reopen the authorization page and
 *   share the first call's result, and `signingIn` stays true until it ends. A
 *   cancel is reported as `cancelled`, not as an error. A completed sign-in
 *   brings the main window back (the flow ends on a browser page) and is
 *   reported once to telemetry, as is a sign-out.
 * - `apiKey()` answers only `ANACONDA_API_KEY_READERS` calling from main; the
 *   key never reaches a renderer, which could claim to be any plugin. The
 *   catalog reads the credentials directly.
 */
import {
	definePlugin,
	KernelApp,
	KernelError,
	KernelLinkedAccount,
	KernelOs,
	KernelTelemetry,
	KernelWindows,
	mainHost,
	type AccountInput,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { ModelCatalogPoint } from "@kilo-desktop/plugin-local-inference/contracts";

import {
	ANACONDA_API_KEY_READERS,
	ANACONDA_LINKED_ACCOUNT,
	ANACONDA_MODEL_CATALOG,
	ANACONDA_SIGNED_IN_KEY,
	ANACONDA_TELEMETRY_EVENTS,
	AnacondaAccount,
	type AnacondaAccountResult,
	type AnacondaAccountSession,
} from "../contracts";
import {
	AnacondaAccountService,
	type AnacondaAccountServiceOptions,
	type AnacondaCredentials,
} from "./AnacondaAccountService";
import { AnacondaCredentialStore } from "./credentials/anaconda-credential-store";
import { createAnacondaModelCatalog } from "./model-catalog";

type SiteCredentials = AnacondaCredentials & Pick<AnacondaCredentialStore, "getSiteDomain">;

export interface AnacondaMainOptions {
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
const SIGNED_IN_KEY = ANACONDA_SIGNED_IN_KEY.slice(ANACONDA_SIGNED_IN_KEY.indexOf("/") + 1);

export function createAnacondaMainEntry(options: AnacondaMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			const version = sdk.domainObjects.get(KernelApp)?.getState().version ?? "0.0.0";
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
					(await sdk.domainObjects.get(KernelOs)?.methods.openExternal({ url })) ?? false,
				logger: sdk.logger,
				...options.service,
			});

			const track = (event: string) => {
				try {
					void sdk.domainObjects
						.get(KernelTelemetry)
						?.methods.track({ event, data: {} })
						.catch(() => undefined);
				} catch {
					// Tracking is best effort, including while the plugin deactivates.
				}
			};

			/** The session once resolved; undefined until then. */
			let resolved: AnacondaAccountSession | undefined;
			const followers = new Set<() => void>();
			const publish = (session: AnacondaAccountSession) => {
				resolved = session;
				sdk.context.set(SIGNED_IN_KEY, session.status === "authenticated");
				for (const follower of followers) follower();
			};
			/** A resolve completed; the first one is published even when nothing changed. */
			const noteResolved = (session: AnacondaAccountSession) => {
				if (!resolved) publish(session);
				return session;
			};
			const follow = (listener: () => void) => {
				followers.add(listener);
				return () => {
					followers.delete(listener);
				};
			};
			sdk.context.set(SIGNED_IN_KEY, false);

			let signInFlow: Promise<AnacondaAccountResult> | undefined;
			let cancelRequested = false;

			const runSignIn = async (): Promise<AnacondaAccountResult> => {
				const next = await service.login();
				if (cancelRequested) return CANCELLED;
				if (next.status === "error") return { ok: false, reason: next.reason };
				if (next.status !== "authenticated") {
					return { ok: false, reason: "Anaconda sign-in did not complete." };
				}
				noteResolved(next);
				track(ANACONDA_TELEMETRY_EVENTS.loggedIn);
				void sdk.domainObjects
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

			const cancelSignIn = () => {
				if (!signInFlow) return;
				cancelRequested = true;
				service.cancelLogin();
			};

			const signOut = async (): Promise<AnacondaAccountResult> => {
				const next = await service.logout();
				if (next.status === "error") return { ok: false, reason: next.reason };
				noteResolved(next);
				track(ANACONDA_TELEMETRY_EVENTS.loggedOut);
				return { ok: true };
			};

			const account = sdk.domainObjects.provide(AnacondaAccount, {
				initialState: { session: ANONYMOUS, signingIn: false },
				methods: {
					session: async () => noteResolved(await service.getSession()),
					refresh: async () => noteResolved(await service.refresh()),
					signIn: () => signIn(),
					cancelSignIn: () => cancelSignIn(),
					signOut: () => signOut(),
					apiKey: (_input, caller) => {
						if (caller.process !== "main" || !ANACONDA_API_KEY_READERS.includes(caller.pluginId)) {
							throw new KernelError(
								"PERMISSION_DENIED",
								"Only kilo.anaconda, in the main process, can read the Anaconda API key.",
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
				publish(session);
			});

			sdk.extensions.implement(KernelLinkedAccount, ANACONDA_LINKED_ACCOUNT, {
				current: () => linkedAccount(resolved),
				subscribe: follow,
			});

			sdk.extensions.implement(
				ModelCatalogPoint,
				ANACONDA_MODEL_CATALOG,
				createAnacondaModelCatalog({
					session: () => resolved,
					resolveSession: async () => {
						noteResolved(await service.getSession());
					},
					subscribe: follow,
					fetch: host.net.fetch,
					credentials,
					logger: sdk.logger,
					signIn,
					cancelSignIn,
				}),
			);

			sdk.onDispose(() => {
				stopFollowing();
				followers.clear();
				service.cancelLogin();
				service.dispose();
			});
		},
	});
}

function linkedAccount(session: AnacondaAccountSession | undefined): AccountInput | null {
	if (session?.status !== "authenticated") return null;
	const { user } = session;
	const id = user.userId ?? user.email ?? user.username;
	if (!id) return null;
	return { id, ...(user.email ? { email: user.email } : {}) };
}

function errorReason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
