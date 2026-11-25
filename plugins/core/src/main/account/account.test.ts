import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	KernelDataCollection,
	KernelIdentity,
	KernelTelemetrySink,
	type DomainObjectProvider,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import {
	Chats,
	CORE_DEFINITIONS,
	KILO_TERMS_URL,
	KILO_TERMS_VERSION,
	KiloAccount,
	KiloServer,
	KiloTerms,
	SIGNED_IN_KEY,
	TERMS_ACCEPTED_KEY,
	type ChatError,
	type KiloProfile,
	type ServerConnection,
	type ServerStatus,
} from "../../contracts";
import {
	activateAccount,
	KiloUnauthorizedError,
	type KiloAccountClient,
	type PersistedTerms,
} from "./index";
import { inMemoryTerms, TermsRecord } from "./terms";

const PROFILE: KiloProfile = {
	profile: {
		email: "ada@example.com",
		name: "Ada Lovelace",
		organizations: [{ id: "org-1", name: "Analytical Engines", role: "owner" }],
		hasPersonalAccount: true,
	},
	balance: { balance: 12.5 },
	kiloPass: {
		currentPeriodBaseCreditsUsd: 20,
		currentPeriodUsageUsd: 5,
		currentPeriodBonusCreditsUsd: 0,
	},
	currentOrgId: null,
};

const CONNECTION: ServerConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.8.27",
	globalDirectory: "/home",
};

/** The Kilo CLI's account API: what the app can read and do through the server. */
class FakeKiloAccount implements KiloAccountClient {
	authenticated = false;
	/** A device sign-in (OAuth), or an API key. */
	credential: "oauth" | "api" = "oauth";
	/** Kilo's model catalog records that it refuses the stored sign-in. */
	refused = false;
	profileResult: KiloProfile | Error = PROFILE;
	readonly disposed = vi.fn(async () => {});
	readonly organizations: (string | null)[] = [];
	#approve: (() => void) | undefined;
	#reject: ((error: Error) => void) | undefined;
	signOutError: Error | undefined;

	async authStatus() {
		return { authenticated: this.authenticated, oauth: this.credential === "oauth" };
	}
	async profile() {
		if (this.profileResult instanceof Error) throw this.profileResult;
		return this.profileResult;
	}
	async catalogRefusesSignIn() {
		return this.authenticated && this.refused;
	}
	async authorize() {
		return {
			url: "https://app.kilo.ai/device",
			instructions: "Enter code: ABCD-1234",
		};
	}
	callback(signal: AbortSignal) {
		return new Promise<void>((resolve, reject) => {
			this.#approve = resolve;
			this.#reject = reject;
			signal.addEventListener("abort", () => reject(new Error("aborted")));
		});
	}
	/** The person approves the code in their browser. */
	approve() {
		this.authenticated = true;
		this.#approve?.();
	}
	deny(message: string) {
		this.#reject?.(new Error(message));
	}
	async signOut() {
		if (this.signOutError) throw this.signOutError;
		this.authenticated = false;
	}
	async setOrganization(organizationId: string | null) {
		this.organizations.push(organizationId);
		if (this.profileResult instanceof Error) return;
		this.profileResult = { ...this.profileResult, currentOrgId: organizationId };
	}
	dispose = this.disposed;
}

afterEach(() => {
	vi.unstubAllEnvs();
});

type Storage = ReturnType<typeof createMemoryStorage>;

interface Booted {
	readonly kernel: MainKernel;
	readonly account: FakeKiloAccount;
	readonly setServerStatus: (status: ServerStatus) => void;
	/** A chat's turn ends, as `kilo.core/chats` reports it. */
	readonly endTurn: (error?: ChatError) => void;
	/** Events delivered through `kernel/telemetry`. */
	readonly tracked: TelemetryEnvelope[];
	readonly storage: Storage;
	readonly focusMain: ReturnType<typeof vi.fn>;
}

const termsKv = (storage: Storage) =>
	storage.kv<PersistedTerms>({ namespace: "terms", defaults: TermsRecord.empty() });

async function boot(
	options: {
		server?: ServerStatus;
		account?: FakeKiloAccount;
		storage?: Storage;
		now?: () => number;
		predecessorTerms?: (() => string | null)[];
		connect?: () => Promise<ServerConnection>;
	} = {},
): Promise<Booted> {
	const account = options.account ?? new FakeKiloAccount();
	const storage = options.storage ?? createMemoryStorage("/data/plugins/kilo.core");
	const tracked: TelemetryEnvelope[] = [];
	const focusMain = vi.fn();
	let server: DomainObjectProvider<typeof KiloServer> | undefined;
	let chats: DomainObjectProvider<typeof Chats> | undefined;
	const unused = () => {
		throw new Error("not used by the account");
	};
	const kernel = createMainKernel({
		host: createTestHost({
			windows: { open: vi.fn(), focus: vi.fn(), close: vi.fn(), setHidden: vi.fn(), focusMain },
		}),
		registrations: [
			{
				manifest,
				definitions: CORE_DEFINITIONS,
				entry: definePlugin({
					activate(sdk) {
						activateAccount(sdk, {
							createClient: () => account,
							termsStorage: termsKv(storage),
							...(options.now ? { now: options.now } : {}),
							...(options.predecessorTerms ? { predecessorTerms: options.predecessorTerms } : {}),
						});
						// Another area provides the server, after the account.
						server = sdk.domainObjects.provide(KiloServer, {
							initialState: options.server ?? { status: "ready", version: "7.8.27" },
							methods: {
								connect: options.connect ?? (async () => CONNECTION),
								restart: () => {},
								disposeInstance: () => {},
								userConfigFile: () => ({ path: "/home/.config/kilo/kilo.jsonc", exists: false }),
							},
						});
						chats = sdk.domainObjects.provide(Chats, {
							initialState: { ready: true, chats: {}, declinedSignInTools: [] },
							methods: {
								create: unused,
								setWorktreeBranch: unused,
								fork: unused,
								chatConfig: unused,
								rename: unused,
								delete: unused,
								setArchived: unused,
								replyQuestion: unused,
								rejectQuestion: unused,
								declineSignInTools: unused,
								permissionRequests: () => [],
								replyPermission: unused,
								prompt: unused,
								abort: unused,
							},
						});
					},
				}),
			},
			testPlugin("acme.analytics", {
				manifest: {
					contributes: { extensions: { "kernel/telemetry-sink": [{ id: "recorder" }] } },
				},
				entry: {
					activate: (sdk) =>
						void sdk.extensions.implement(KernelTelemetrySink, "recorder", {
							deliver: (envelope) => void tracked.push(envelope),
						}),
				},
			}),
		],
	});
	kernel.kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: {
			choice: true,
			allowed: true,
			installationId: "install-1",
			environment: "stable",
		},
		methods: { setChoice: () => {} },
	});
	await kernel.start();
	return {
		kernel,
		account,
		setServerStatus: (status) => server?.setState(status),
		endTurn: (error) => chats?.emit("turn-ended", { chatId: "ses-1", ...(error ? { error } : {}) }),
		tracked,
		storage,
		focusMain,
	};
}

const accountOf = (kernel: MainKernel) => kernel.kernelSdk.domainObjects.get(KiloAccount)!;
const termsOf = (kernel: MainKernel) => kernel.kernelSdk.domainObjects.get(KiloTerms)!;
const identityOf = (kernel: MainKernel) => kernel.kernelSdk.domainObjects.get(KernelIdentity)!;
const events = (tracked: TelemetryEnvelope[]) => tracked.map(({ key }) => key);

describe("the Kilo account", () => {
	it("reads a signed-out account once the server is ready", async () => {
		const { kernel } = await boot();

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				connection: "connected",
				signedIn: false,
				profile: null,
			}),
		);
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(false);
		expect(identityOf(kernel).getState().primary).toBeNull();
	});

	it("reads the signed-in profile with organizations, balance and Kilo Pass", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				signedIn: true,
				profile: PROFILE,
				profileError: null,
			}),
		);
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(true);
	});

	it("reports a profile that cannot be read, keeping the sign-in Kilo still accepts", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.profileResult = new Error("Kilo API unavailable");
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				signedIn: true,
				profile: null,
				profileError: "Kilo API unavailable",
				signInExpired: false,
			}),
		);
		expect(account.authenticated).toBe(true);
		expect(identityOf(kernel).getState().primary).toBeNull();
	});

	it("signs out a sign-in Kilo no longer accepts, and says it expired", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.refused = true;
		account.profileResult = new Error("Bad Request");
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				signedIn: false,
				signInExpired: true,
				profile: null,
				profileError: null,
			}),
		);
		expect(account.authenticated).toBe(false);
		expect(account.disposed).toHaveBeenCalled();
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(false);
	});

	it("signs out a sign-in whose profile Kilo refuses, even with a catalog that hides it", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.profileResult = new KiloUnauthorizedError("Unauthorized");
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({ signedIn: false, signInExpired: true }),
		);
		expect(account.authenticated).toBe(false);
	});

	it("keeps an API key Kilo answers the profile read for with 401", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.credential = "api";
		account.profileResult = new KiloUnauthorizedError("Unauthorized");
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				signedIn: true,
				signInExpired: false,
				profileError: "Unauthorized",
			}),
		);
		expect(account.authenticated).toBe(true);
	});

	it("signs out when a chat's request finds Kilo no longer accepts the sign-in", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel, endTurn } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));
		account.profileResult = new Error("Bad Request");

		endTurn({ name: "APIError", message: "Signed out", status: 401, code: "INVALID_TOKEN" });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				signedIn: false,
				signInExpired: true,
				profile: null,
			}),
		);
		expect(account.authenticated).toBe(false);
	});

	it("keeps a sign-in another app renewed after the server's copy was refused", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel, endTurn } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));
		// The server still holds the refused sign-in; reloading picks up the renewed one.
		account.profileResult = new Error("Bad Request");
		account.disposed.mockImplementation(async () => {
			account.profileResult = PROFILE;
		});

		endTurn({ name: "APIError", message: "Signed out", status: 401, code: "INVALID_TOKEN" });

		await vi.waitFor(() => expect(account.disposed).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				signedIn: true,
				signInExpired: false,
				profile: PROFILE,
			}),
		);
		expect(account.authenticated).toBe(true);
	});

	it("keeps the sign-in through other failed chat requests", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel, endTurn } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));

		endTurn({
			name: "APIError",
			message: "Sign in",
			status: 401,
			code: "PAID_MODEL_AUTH_REQUIRED",
		});
		endTurn({ name: "APIError", message: "Odd", status: 500, code: "INVALID_TOKEN" });
		endTurn({ name: "APIError", message: "Rate limited", status: 429 });
		endTurn();
		await accountOf(kernel).methods.refresh(undefined);

		expect(accountOf(kernel).getState()).toMatchObject({ signedIn: true, signInExpired: false });
		expect(account.authenticated).toBe(true);
	});

	it("treats an unreadable sign-in status as signed out", async () => {
		const account = new FakeKiloAccount();
		account.authStatus = async () => {
			throw new Error("Kilo API unavailable");
		};
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(accountOf(kernel).getState()).toMatchObject({
				connection: "connected",
				signedIn: false,
			}),
		);
	});

	it("can't sign in while the server is unavailable", async () => {
		const { kernel } = await boot({ server: { status: "error", message: "No CLI." } });

		await expect(accountOf(kernel).methods.signIn(undefined)).resolves.toEqual({
			signedIn: false,
		});
		expect(accountOf(kernel).getState().deviceSignIn.status).toBe("idle");
	});

	it("says the server is unavailable when it can't connect", async () => {
		const booted = await boot({
			server: { status: "starting" },
			connect: () => Promise.reject(new Error("gone")),
		});

		booted.setServerStatus({ status: "ready", version: "7.8.27" });

		await vi.waitFor(() =>
			expect(accountOf(booted.kernel).getState().connection).toBe("unavailable"),
		);
	});

	it("waits for the server, and says when it can't be reached", async () => {
		const { kernel, setServerStatus } = await boot({ server: { status: "starting" } });
		expect(accountOf(kernel).getState()).toMatchObject({
			connection: "pending",
			signedIn: null,
		});

		setServerStatus({ status: "error", message: "Kilo server exited unexpectedly." });
		expect(accountOf(kernel).getState().connection).toBe("unavailable");

		setServerStatus({ status: "ready", version: "7.8.27" });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));
	});
});

describe("the Kilo account as the kernel identity", () => {
	it("is the primary account, keyed on email, with its organisation and not its name", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.profileResult = { ...PROFILE, currentOrgId: "org-1" };
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(identityOf(kernel).getState().primary).toEqual({
				id: "ada@example.com",
				email: "ada@example.com",
				organization: { id: "org-1", name: "Analytical Engines" },
				attributes: { isEmployee: false },
				source: "kilo.core/kilo-account",
			}),
		);
	});

	it("marks Anaconda employees and follows sign-out", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.profileResult = {
			...PROFILE,
			profile: { email: "grace@Anaconda.com" },
		};
		const { kernel } = await boot({ account });
		await vi.waitFor(() =>
			expect(identityOf(kernel).getState().primary).toMatchObject({
				id: "grace@Anaconda.com",
				attributes: { isEmployee: true },
			}),
		);
		expect(identityOf(kernel).getState().primary).not.toHaveProperty("organization");

		await accountOf(kernel).methods.signOut(undefined);

		expect(identityOf(kernel).getState().primary).toBeNull();
	});
});

describe("signing in to Kilo", () => {
	it("shows the device code, then signs in once approved in the browser", async () => {
		const { kernel, account, tracked, focusMain } = await boot();
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));

		const signingIn = accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn).toMatchObject({
				status: "waiting",
				code: "ABCD-1234",
				verificationUrl: "https://app.kilo.ai/device",
			}),
		);
		account.approve();

		await expect(signingIn).resolves.toEqual({ signedIn: true });
		expect(accountOf(kernel).getState()).toMatchObject({
			signedIn: true,
			profile: PROFILE,
			deviceSignIn: { status: "idle" },
		});
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(true);
		await vi.waitFor(() => expect(focusMain).toHaveBeenCalled());
		expect(account.disposed).toHaveBeenCalled();
		await vi.waitFor(() => expect(events(tracked)).toContain("kilo.core/logged-in"));
		expect(tracked.find(({ key }) => key === "kilo.core/logged-in")).toMatchObject({
			name: "Logged In",
			data: {},
		});
	});

	it("shows the browser's user code, not the poll secret in the instructions", async () => {
		const account = new FakeKiloAccount();
		account.authorize = async () => ({
			url: "https://app.kilo.ai/device-auth?code=WXYZ-1234",
			instructions: "Open https://app.kilo.ai/device-auth and enter code: 04jF-r2ARIPUwnvoNxQJ8oY1",
		});
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));

		void accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn).toMatchObject({
				status: "waiting",
				code: "WXYZ-1234",
				verificationUrl: "https://app.kilo.ai/device-auth?code=WXYZ-1234",
			}),
		);
	});

	it("shares one flow between concurrent sign-ins", async () => {
		const { kernel, account } = await boot();
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));
		const authorize = vi.spyOn(account, "authorize");

		const first = accountOf(kernel).methods.signIn(undefined);
		const second = accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn.status).toBe("waiting"),
		);
		account.approve();

		await expect(Promise.all([first, second])).resolves.toEqual([
			{ signedIn: true },
			{ signedIn: true },
		]);
		expect(authorize).toHaveBeenCalledOnce();
	});

	it("cancels a sign-in so a later approval can't land", async () => {
		const { kernel, account } = await boot();
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));

		const signingIn = accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn.status).toBe("waiting"),
		);
		await accountOf(kernel).methods.cancelSignIn(undefined);

		await expect(signingIn).resolves.toEqual({ signedIn: false });
		expect(accountOf(kernel).getState().deviceSignIn).toEqual({ status: "idle" });
		account.approve();
		expect(accountOf(kernel).getState().deviceSignIn).toEqual({ status: "idle" });
	});

	it("abandons a sign-in when the server goes away", async () => {
		const { kernel, setServerStatus } = await boot();
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));

		const signingIn = accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn.status).toBe("waiting"),
		);
		setServerStatus({ status: "starting" });

		await expect(signingIn).resolves.toEqual({ signedIn: false });
		expect(accountOf(kernel).getState()).toMatchObject({
			connection: "pending",
			deviceSignIn: { status: "idle" },
		});
	});

	it("explains a sign-in that fails", async () => {
		const { kernel, account } = await boot();
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));

		const signingIn = accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn.status).toBe("waiting"),
		);
		account.deny("The code expired.");

		await expect(signingIn).resolves.toEqual({ signedIn: false });
		expect(accountOf(kernel).getState().deviceSignIn).toEqual({
			status: "error",
			error: "The code expired.",
		});
	});

	it("says sign-in failed when the CLI gives no reason", async () => {
		const account = new FakeKiloAccount();
		account.authorize = async () => {
			throw {};
		};
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(false));

		await accountOf(kernel).methods.signIn(undefined);

		expect(accountOf(kernel).getState().deviceSignIn).toEqual({
			status: "error",
			error: "Sign-in failed",
		});
	});

	it("clears an expired sign-in once signed in again", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.refused = true;
		account.profileResult = new Error("Bad Request");
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signInExpired).toBe(true));
		account.refused = false;
		account.profileResult = PROFILE;

		const signingIn = accountOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(accountOf(kernel).getState().deviceSignIn.status).toBe("waiting"),
		);
		account.approve();

		await expect(signingIn).resolves.toEqual({ signedIn: true });
		expect(accountOf(kernel).getState()).toMatchObject({
			signedIn: true,
			signInExpired: false,
			profile: PROFILE,
		});
	});

	it("signs out even when the credentials are already gone", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.signOutError = new Error("401 Unauthorized");
		const { kernel, tracked } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));
		account.authenticated = false;

		await accountOf(kernel).methods.signOut(undefined);

		expect(accountOf(kernel).getState()).toMatchObject({ signedIn: false, profile: null });
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(false);
		await vi.waitFor(() => expect(events(tracked)).toContain("kilo.core/logged-out"));
	});

	it("switches organization and reads the account again", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));

		await accountOf(kernel).methods.setOrganization({ organizationId: "org-1" });

		expect(account.organizations).toEqual(["org-1"]);
		expect(accountOf(kernel).getState()).toMatchObject({
			profile: { currentOrgId: "org-1" },
			switchingOrganization: false,
			organizationError: null,
		});
		expect(identityOf(kernel).getState().primary?.organization).toEqual({
			id: "org-1",
			name: "Analytical Engines",
		});
	});

	it("reports a failed organization switch until the next switch", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const setOrganization = account.setOrganization.bind(account);
		account.setOrganization = async () => {
			throw new Error("Not a member.");
		};
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));

		await accountOf(kernel).methods.setOrganization({ organizationId: "org-2" });
		expect(accountOf(kernel).getState().organizationError).toEqual({
			message: "Not a member.",
			organizationId: "org-2",
		});

		account.setOrganization = setOrganization;
		await accountOf(kernel).methods.setOrganization({ organizationId: null });
		expect(accountOf(kernel).getState().organizationError).toBeNull();
	});
});

describe("the terms of service", () => {
	it("records acceptance of the current terms and keeps the first acceptance time", async () => {
		let now = 1_000;
		const { kernel, tracked } = await boot({ now: () => now });
		expect(termsOf(kernel).getState()).toEqual({
			version: KILO_TERMS_VERSION,
			accepted: false,
			acceptedAt: null,
		});
		expect(kernel.kernelSdk.context.get(TERMS_ACCEPTED_KEY)).toBe(false);

		await termsOf(kernel).methods.accept({ version: KILO_TERMS_VERSION });
		now = 2_000;
		await termsOf(kernel).methods.accept({ version: KILO_TERMS_VERSION });

		expect(termsOf(kernel).getState()).toEqual({
			version: KILO_TERMS_VERSION,
			accepted: true,
			acceptedAt: 1_000,
		});
		expect(kernel.kernelSdk.context.get(TERMS_ACCEPTED_KEY)).toBe(true);
		await vi.waitFor(() => expect(events(tracked)).toContain("kilo.core/terms-accepted"));
		const accepted = tracked.filter(({ key }) => key === "kilo.core/terms-accepted");
		expect(accepted).toHaveLength(1);
		expect(accepted[0]).toMatchObject({
			name: "Terms Accepted",
			data: {
				termsVersion: KILO_TERMS_VERSION,
				termsUrl: KILO_TERMS_URL,
				$set_once: {
					terms_accepted_at: new Date(1_000).toISOString(),
					terms_version: KILO_TERMS_VERSION,
				},
			},
		});
	});

	it("asks again when the terms change", async () => {
		const storage = createMemoryStorage();
		termsKv(storage).set({ version: "2020-01-01", acceptedAt: 5, linkedAccounts: [] });
		const { kernel } = await boot({ storage });

		expect(termsOf(kernel).getState().accepted).toBe(false);
		expect(kernel.kernelSdk.context.get(TERMS_ACCEPTED_KEY)).toBe(false);
	});

	it("rejects accepting terms other than the current ones", async () => {
		const { kernel } = await boot();

		await expect(termsOf(kernel).methods.accept({ version: "2020-01-01" })).rejects.toMatchObject({
			code: "VALIDATION",
		});
	});

	it("links the acceptance to each signed-in account once, by hash", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel, tracked, storage } = await boot({ account });
		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));
		await termsOf(kernel).methods.accept({ version: KILO_TERMS_VERSION });
		await vi.waitFor(() => expect(events(tracked)).toContain("kilo.core/terms-linked"));

		await accountOf(kernel).methods.refresh(undefined);

		const linked = tracked.filter(({ key }) => key === "kilo.core/terms-linked");
		expect(linked).toHaveLength(1);
		expect(linked[0]).toMatchObject({
			name: "Terms Acceptance Linked",
			data: { termsVersion: KILO_TERMS_VERSION, termsUrl: KILO_TERMS_URL },
		});
		const saved = termsKv(storage).snapshot();
		const hash = createHash("sha256").update("kilo-terms:ada@example.com").digest("hex");
		expect(saved.linkedAccounts).toEqual([hash]);
		expect(JSON.stringify(saved)).not.toContain("ada@example.com");
	});

	it("adopts kilo.account's acceptance before origin's, without reporting a new acceptance", async () => {
		const account = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: ["old"] };
		const origin = vi.fn(() =>
			JSON.stringify({ version: KILO_TERMS_VERSION, acceptedAt: 7, linkedAccounts: [] }),
		);
		const { kernel, tracked, storage } = await boot({
			predecessorTerms: [() => JSON.stringify({ ...account, importedFromOrigin: true }), origin],
		});

		expect(termsOf(kernel).getState()).toEqual({
			version: KILO_TERMS_VERSION,
			accepted: true,
			acceptedAt: 42,
		});
		expect(origin).not.toHaveBeenCalled();
		expect(termsKv(storage).snapshot()).toEqual({ ...account, adoptedPredecessors: true });
		expect(kernel.kernelSdk.context.get(TERMS_ACCEPTED_KEY)).toBe(true);
		await termsOf(kernel).methods.accept({ version: KILO_TERMS_VERSION });
		expect(events(tracked)).not.toContain("kilo.core/terms-accepted");

		const later = { version: KILO_TERMS_VERSION, acceptedAt: 99, linkedAccounts: [] };
		const second = await boot({ storage, predecessorTerms: [() => JSON.stringify(later)] });
		expect(termsOf(second.kernel).getState().acceptedAt).toBe(42);
	});

	it("falls back to origin's acceptance when kilo.account saved none", async () => {
		const origin = { version: KILO_TERMS_VERSION, acceptedAt: 7, linkedAccounts: [] };
		const { kernel } = await boot({
			predecessorTerms: [() => null, () => "not json", () => JSON.stringify(origin)],
		});

		expect(termsOf(kernel).getState().acceptedAt).toBe(7);
	});

	it("keeps an acceptance made here over an earlier one", async () => {
		const storage = createMemoryStorage();
		termsKv(storage).set({ version: KILO_TERMS_VERSION, acceptedAt: 1, linkedAccounts: [] });
		const earlier = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: [] };
		const { kernel } = await boot({ storage, predecessorTerms: [() => JSON.stringify(earlier)] });

		expect(termsOf(kernel).getState().acceptedAt).toBe(1);
	});

	it("doesn't link an account kilo.account or origin already linked", async () => {
		// Origin keyed accounts by `userId || email.toLowerCase()`; its session never carried a userId.
		const earlierKey = createHash("sha256").update("kilo-terms:ada@example.com").digest("hex");
		const earlier = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: [earlierKey] };
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel, tracked } = await boot({
			account,
			predecessorTerms: [() => JSON.stringify(earlier)],
		});

		await vi.waitFor(() => expect(accountOf(kernel).getState().signedIn).toBe(true));
		await accountOf(kernel).methods.refresh(undefined);

		expect(termsOf(kernel).getState().accepted).toBe(true);
		expect(events(tracked)).not.toContain("kilo.core/terms-linked");
	});

	it("tries the earlier acceptance again next launch when it can't be read", async () => {
		const storage = createMemoryStorage();
		const first = await boot({
			storage,
			predecessorTerms: [
				() => {
					throw new Error("EBUSY");
				},
			],
		});
		expect(termsOf(first.kernel).getState().accepted).toBe(false);

		const earlier = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: [] };
		const second = await boot({ storage, predecessorTerms: [() => JSON.stringify(earlier)] });

		expect(termsOf(second.kernel).getState().accepted).toBe(true);
	});
});

describe("inMemoryTerms", () => {
	it("keeps the terms without touching storage", () => {
		const terms = inMemoryTerms(TermsRecord.empty());

		terms.set({ version: KILO_TERMS_VERSION, acceptedAt: 1 });

		expect(terms.snapshot()).toMatchObject({ version: KILO_TERMS_VERSION, acceptedAt: 1 });
	});
});
