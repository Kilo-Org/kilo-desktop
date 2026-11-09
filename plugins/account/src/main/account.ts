import {
	definePlugin,
	KernelError,
	KernelWindows,
	mainHost,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { AgentServer, type ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

import {
	Identity,
	KILO_TERMS_VERSION,
	Terms,
	type IdentityState,
	type TermsState,
} from "../contracts";
import {
	errorMessage,
	IdentityService,
	INITIAL_IDENTITY,
	type KiloAccountClient,
} from "./identity";
import { accountHash, inMemoryTerms, TermsRecord, type PersistedTerms } from "./terms";

export type { KiloAccountClient } from "./identity";

export interface AccountMainOptions {
	readonly createClient: (connection: ServerConnection, sdk: PluginSdk) => KiloAccountClient;
	readonly now?: () => number;
	/** Reads the terms acceptance origin's kilo-ui saved; null when there is none. */
	readonly readOriginTerms?: (sdk: PluginSdk) => string | null;
}

const SIGNED_IN = "signedIn";
const TERMS_ACCEPTED = "termsAccepted";

/**
 * kilo.account in main. Identity follows kilo.agent's server: it is read once
 * the server is ready and re-read after every sign-in, sign-out or
 * organization switch; `signedIn` mirrors it. Terms acceptance is local
 * (kv), and `termsAccepted` gates the Kilo server, so identity can only be
 * read after acceptance — the welcome step asks before anything needs Kilo.
 * Signing in after acceptance links the acceptance to that account once.
 * Analytics come from the domain events, reported by kilo.telemetry.
 */
export function createAccountMainEntry(options: AccountMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const now = options.now ?? Date.now;
			let client: KiloAccountClient | undefined;

			const record = new TermsRecord(termsStorage(sdk), now);
			const readOriginTerms = options.readOriginTerms;
			if (readOriginTerms) {
				// Before `termsAccepted` is first published, so the server gate and welcome step don't flash.
				try {
					record.importOrigin(() => readOriginTerms(sdk));
				} catch (error) {
					sdk.logger.warn(
						`Could not import origin's terms acceptance; will try again next launch: ${errorMessage(error, "unknown error")}`,
					);
				}
			}
			const termsState = (): TermsState => {
				const acceptedAt = record.acceptedAt(KILO_TERMS_VERSION);
				return { version: KILO_TERMS_VERSION, accepted: acceptedAt !== null, acceptedAt };
			};
			const terms: DomainProvider<typeof Terms> = sdk.domains.provide(Terms, {
				initialState: termsState(),
				methods: {
					accept: ({ version }) => {
						if (version !== KILO_TERMS_VERSION) {
							throw new KernelError(
								"VALIDATION",
								`Only the current terms (${KILO_TERMS_VERSION}) can be accepted.`,
							);
						}
						const first = record.accept(version);
						terms.setState(termsState());
						sdk.context.set(TERMS_ACCEPTED, true);
						if (first) terms.emit("accepted", { version });
						linkSignedInAccount(service.state);
						return terms.state;
					},
				},
			});
			sdk.context.set(TERMS_ACCEPTED, terms.state.accepted);

			const identity = sdk.domains.provide(Identity, {
				initialState: INITIAL_IDENTITY,
				methods: {
					signIn: () => service.signIn(),
					cancelSignIn: () => service.cancelSignIn(),
					signOut: () => service.signOut(),
					refresh: () => service.refresh(),
					setOrganization: ({ organizationId }) => service.setOrganization(organizationId),
					dismissOrgError: () => service.dismissOrgError(),
				},
			});
			const service = new IdentityService({
				client: () => client,
				onChange: (state) => {
					identity.setState(state);
					sdk.context.set(SIGNED_IN, state.authenticated === true);
					linkSignedInAccount(state);
				},
				onSignedIn: () => identity.emit("signed-in", {}),
				onSignedOut: () => identity.emit("signed-out", {}),
				focusApp: () =>
					void sdk.domains
						.get(KernelWindows)
						?.methods.focusMain(undefined)
						.catch(() => undefined),
			});

			function linkSignedInAccount(state: IdentityState): void {
				const email = state.authenticated ? state.profile?.profile.email : undefined;
				if (!email || !terms.state.accepted) return;
				if (record.link(accountHash(email))) {
					terms.emit("linked", { version: KILO_TERMS_VERSION });
				}
			}

			const connect = async () => {
				const server = sdk.domains.get(AgentServer);
				if (!server) return service.setConnection("unavailable");
				try {
					client = options.createClient(await server.methods.connect(undefined), sdk);
					service.setConnection("connected");
				} catch {
					service.setConnection("unavailable");
				}
			};
			let stopServer: (() => void) | undefined;
			if (!sdk.domains.get(AgentServer)) service.setConnection("unavailable");
			sdk.domains.track(AgentServer, {
				added(server) {
					const follow = (status: ReturnType<typeof server.getState>) => {
						if (status.status === "ready") void connect();
						else service.setConnection(status.status === "error" ? "unavailable" : "pending");
					};
					follow(server.getState());
					stopServer = server.subscribe(follow);
				},
				removed() {
					stopServer?.();
					client = undefined;
					service.setConnection("unavailable");
				},
			});
			sdk.onDispose(() => {
				stopServer?.();
				service.cancelSignIn();
			});
		},
	});
}

/**
 * Packaged e2e runs (`KILO_SKIP_ONBOARDING=1`) treat the current terms as
 * accepted in memory, so the gate stays out of the way without touching the
 * profile.
 */
function termsStorage(sdk: PluginSdk) {
	if (process.env["KILO_SKIP_ONBOARDING"] === "1") {
		return inMemoryTerms({ version: KILO_TERMS_VERSION, acceptedAt: 1, linkedAccounts: [] });
	}
	return mainHost(sdk).storage.kv<PersistedTerms>({
		namespace: "terms",
		defaults: TermsRecord.empty(),
	});
}
