import {
	KernelError,
	KernelIdentityProvider,
	KernelTelemetry,
	KernelWindows,
	type AccountSource,
	type DomainObjectProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import {
	KILO_TERMS_URL,
	KILO_TERMS_VERSION,
	KiloAccount,
	KiloServer,
	KiloTerms,
	type AccountState,
	type ServerConnection,
	type TermsState,
} from "../../contracts";
import {
	AccountService,
	errorMessage,
	INITIAL_ACCOUNT,
	type KiloAccountClient,
} from "./account-service";
import { kernelAccountFor } from "./identity";
import { accountHash, TermsRecord, type TermsStorage } from "./terms";

export type { KiloAccountClient } from "./account-service";
export type { PersistedTerms, TermsStorage } from "./terms";

export interface AccountOptions {
	readonly createClient: (connection: ServerConnection) => KiloAccountClient;
	/** Where this device's terms acceptance is kept. */
	readonly termsStorage: TermsStorage;
	/**
	 * Acceptances saved before kilo.core, newest first (kilo.account's, then
	 * origin's kilo-ui's): each returns the saved JSON, or null when there is none.
	 */
	readonly predecessorTerms?: readonly (() => string | null)[];
	readonly now?: () => number;
}

const SIGNED_IN = "signedIn";
const TERMS_ACCEPTED = "termsAccepted";

/**
 * The account area: `kilo.core/account` and `kilo.core/terms`. The account
 * follows the Kilo server: it is read once the server is ready and re-read
 * after every sign-in, sign-out or organisation switch; `signedIn` mirrors
 * it, and it is the kernel's primary identity (`kilo-account`). Terms
 * acceptance is local (kv), and `termsAccepted` gates the Kilo server, so
 * the account can only be read after acceptance. Signing in after acceptance
 * links the acceptance to that account once. Sign-in, sign-out and terms
 * events are reported through `kernel/telemetry`.
 */
export function activateAccount(sdk: PluginSdk, options: AccountOptions): void {
	const now = options.now ?? Date.now;
	let client: KiloAccountClient | undefined;

	const track = (event: string, data: Record<string, unknown> = {}) =>
		void sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data })
			.catch(() => undefined);

	const record = new TermsRecord(options.termsStorage, now);
	// Before `termsAccepted` is first published, so the server gate and welcome step don't flash.
	try {
		record.adoptPredecessors(options.predecessorTerms ?? []);
	} catch (error) {
		sdk.logger.warn(
			`Could not adopt the earlier terms acceptance; will try again next launch: ${errorMessage(error, "unknown error")}`,
		);
	}
	const termsState = (): TermsState => {
		const acceptedAt = record.acceptedAt(KILO_TERMS_VERSION);
		return { version: KILO_TERMS_VERSION, accepted: acceptedAt !== null, acceptedAt };
	};
	const termsProperties = (version: string) => {
		const acceptedAt = terms.state.acceptedAt;
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
	const terms: DomainObjectProvider<typeof KiloTerms> = sdk.domainObjects.provide(KiloTerms, {
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
				if (first) {
					terms.emit("accepted", { version });
					track("terms-accepted", termsProperties(version));
				}
				linkSignedInAccount(service.state);
				return terms.state;
			},
		},
	});
	sdk.context.set(TERMS_ACCEPTED, terms.state.accepted);

	const identityListeners = new Set<() => void>();
	const account = sdk.domainObjects.provide(KiloAccount, {
		initialState: INITIAL_ACCOUNT,
		methods: {
			signIn: () => service.signIn(),
			cancelSignIn: () => service.cancelSignIn(),
			signOut: () => service.signOut(),
			refresh: () => service.refresh(),
			setOrganization: ({ organizationId }) => service.setOrganization(organizationId),
		},
	});
	const service = new AccountService({
		client: () => client,
		onChange: (state) => {
			account.setState(state);
			sdk.context.set(SIGNED_IN, state.signedIn === true);
			for (const listener of identityListeners) listener();
			linkSignedInAccount(state);
		},
		onSignedIn: () => {
			account.emit("signed-in", {});
			track("logged-in");
		},
		onSignedOut: () => {
			account.emit("signed-out", {});
			track("logged-out");
		},
		focusApp: () =>
			void sdk.domainObjects
				.get(KernelWindows)
				?.methods.focusMain(undefined)
				.catch(() => undefined),
	});

	const identity: AccountSource = {
		current: () => kernelAccountFor(service.state),
		subscribe: (listener) => {
			identityListeners.add(listener);
			return () => identityListeners.delete(listener);
		},
	};
	sdk.extensions.implement(KernelIdentityProvider, "kilo-account", identity);

	function linkSignedInAccount(state: AccountState): void {
		const email = state.signedIn ? state.profile?.email : undefined;
		if (!email || !terms.state.accepted) return;
		if (record.link(accountHash(email))) {
			terms.emit("linked", { version: KILO_TERMS_VERSION });
			track("terms-linked", termsProperties(KILO_TERMS_VERSION));
		}
	}

	// The server is provided by another kilo.core area, usually after this one,
	// so the account stays `pending` until it appears.
	let stopServer: (() => void) | undefined;
	sdk.domainObjects.track(KiloServer, {
		added(server) {
			const connect = async () => {
				try {
					client = options.createClient(await server.methods.connect(undefined));
					service.setConnection("connected");
				} catch {
					service.setConnection("unavailable");
				}
			};
			const follow = (status: ReturnType<typeof server.getState>) => {
				if (status.status === "ready") void connect();
				else service.setConnection(status.status === "error" ? "unavailable" : "pending");
			};
			follow(server.getState());
			stopServer = server.subscribe(follow);
		},
		removed() {
			stopServer?.();
			stopServer = undefined;
			client = undefined;
			service.setConnection("unavailable");
		},
	});
	sdk.onDispose(() => {
		stopServer?.();
		service.cancelSignIn();
	});
}
