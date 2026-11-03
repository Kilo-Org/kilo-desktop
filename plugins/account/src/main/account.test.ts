import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainProvider, PluginEntry } from "@kilo-desktop/kernel";
import { createMainKernel, type MainKernel } from "@kilo-desktop/kernel/main";
import { createMemoryStorage, createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";
import { AgentServer, type ServerStatus } from "@kilo-desktop/plugin-agent/contracts";

import manifest from "../../plugin.json";
import {
	ACCOUNT_DEFINITIONS,
	Identity,
	KILO_TERMS_VERSION,
	SIGNED_IN_KEY,
	Terms,
	TERMS_ACCEPTED_KEY,
	type KiloProfileData,
} from "../contracts";
import { createAccountMainEntry, type KiloAccountClient } from "./account";

const PROFILE: KiloProfileData = {
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

/** The Kilo CLI's account API: what the app can read and do through the server. */
class FakeKiloAccount implements KiloAccountClient {
	authenticated = false;
	profileResult: KiloProfileData | Error = PROFILE;
	readonly disposed = vi.fn(async () => {});
	readonly organizations: (string | null)[] = [];
	#approve: (() => void) | undefined;
	#reject: ((error: Error) => void) | undefined;
	signOutError: Error | undefined;

	async authStatus() {
		return { authenticated: this.authenticated };
	}
	async profile() {
		if (this.profileResult instanceof Error) throw this.profileResult;
		return this.profileResult;
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

/** Stands in for kilo.agent: a server whose status the test drives. */
function fakeAgent(initial: ServerStatus) {
	let server: DomainProvider<typeof AgentServer> | undefined;
	const entry: PluginEntry = {
		activate(sdk) {
			server = sdk.domains.provide(AgentServer, {
				initialState: initial,
				methods: {
					connect: async () => ({
						baseUrl: "http://127.0.0.1:4321",
						username: "kilo",
						password: "secret",
						version: "7.8.17",
						globalDirectory: "/home",
					}),
					restart: () => {},
					disposeInstance: () => {},
				},
			});
		},
	};
	return {
		registration: testPlugin("kilo.agent", {
			manifest: { domains: [{ id: "server", home: "main" }] },
			definitions: { domains: [AgentServer] },
			entry,
		}),
		setStatus: (status: ServerStatus) => server?.setState(status),
	};
}

afterEach(() => {
	vi.unstubAllEnvs();
});

interface Booted {
	readonly kernel: MainKernel;
	readonly account: FakeKiloAccount;
	readonly agent: ReturnType<typeof fakeAgent>;
	readonly tracked: { event: string; data: Record<string, unknown> }[];
	readonly storage: ReturnType<typeof createMemoryStorage>;
	readonly focusMain: ReturnType<typeof vi.fn>;
}

async function boot(
	options: {
		server?: ServerStatus;
		account?: FakeKiloAccount;
		storage?: ReturnType<typeof createMemoryStorage>;
		now?: () => number;
		readOriginTerms?: () => string | null;
	} = {},
): Promise<Booted> {
	const account = options.account ?? new FakeKiloAccount();
	const agent = fakeAgent(options.server ?? { status: "ready", version: "7.8.17" });
	const tracked: { event: string; data: Record<string, unknown> }[] = [];
	const storage = options.storage ?? createMemoryStorage("/data/kilo.account");
	const focusMain = vi.fn();
	const kernel = createMainKernel({
		host: createTestHost({
			windows: { open: vi.fn(), focus: vi.fn(), close: vi.fn(), setHidden: vi.fn(), focusMain },
		}),
		registrations: [
			agent.registration,
			{
				manifest,
				definitions: ACCOUNT_DEFINITIONS,
				entry: createAccountMainEntry({
					createClient: () => account,
					...(options.now ? { now: options.now } : {}),
					...(options.readOriginTerms ? { readOriginTerms: options.readOriginTerms } : {}),
				}),
			},
		],
		hostServices: () => ({ storage }),
	});
	await kernel.start();
	const record = (event: string) => () => tracked.push({ event, data: {} });
	identityOf(kernel).on("signed-in", record("Logged In"));
	identityOf(kernel).on("signed-out", record("Logged Out"));
	termsOf(kernel).on("accepted", record("Terms Accepted"));
	termsOf(kernel).on("linked", record("Terms Acceptance Linked"));
	return { kernel, account, agent, tracked, storage, focusMain };
}

const identityOf = (kernel: MainKernel) => kernel.kernelSdk.domains.get(Identity)!;
const termsOf = (kernel: MainKernel) => kernel.kernelSdk.domains.get(Terms)!;

describe("kilo.account identity", () => {
	it("reads a signed-out account once the server is ready", async () => {
		const { kernel } = await boot();

		await vi.waitFor(() =>
			expect(identityOf(kernel).getState()).toMatchObject({
				connection: "connected",
				authenticated: false,
				profile: null,
			}),
		);
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(false);
	});

	it("reads the signed-in profile with organizations, balance and Kilo Pass", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(identityOf(kernel).getState()).toMatchObject({
				authenticated: true,
				profile: PROFILE,
				profileError: null,
			}),
		);
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(true);
	});

	it("reports a profile that cannot be read", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.profileResult = new Error("Kilo API unavailable");
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(identityOf(kernel).getState()).toMatchObject({
				authenticated: true,
				profile: null,
				profileError: "Kilo API unavailable",
			}),
		);
	});

	it("treats an unreadable sign-in status as signed out", async () => {
		const account = new FakeKiloAccount();
		account.authStatus = async () => {
			throw new Error("Kilo API unavailable");
		};
		const { kernel } = await boot({ account });

		await vi.waitFor(() =>
			expect(identityOf(kernel).getState()).toMatchObject({
				connection: "connected",
				authenticated: false,
			}),
		);
	});

	it("can't sign in while the server is unavailable", async () => {
		const { kernel } = await boot({ server: { status: "error", message: "No CLI." } });

		await expect(identityOf(kernel).methods.signIn(undefined)).resolves.toEqual({
			signedIn: false,
		});
		expect(identityOf(kernel).getState().deviceAuth.status).toBe("idle");
	});

	it("waits for the server, and says when it can't be reached", async () => {
		const { kernel, agent } = await boot({ server: { status: "starting" } });
		expect(identityOf(kernel).getState()).toMatchObject({
			connection: "pending",
			authenticated: null,
		});

		agent.setStatus({ status: "error", message: "Kilo server exited unexpectedly." });
		expect(identityOf(kernel).getState().connection).toBe("unavailable");

		agent.setStatus({ status: "ready", version: "7.8.17" });
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(false));
	});
});

describe("kilo.account sign-in", () => {
	it("shows the device code, then signs in once approved in the browser", async () => {
		const { kernel, account, tracked, focusMain } = await boot();
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(false));

		const signingIn = identityOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() =>
			expect(identityOf(kernel).getState().deviceAuth).toMatchObject({
				status: "waiting",
				code: "ABCD-1234",
				verificationUrl: "https://app.kilo.ai/device",
			}),
		);
		account.approve();

		await expect(signingIn).resolves.toEqual({ signedIn: true });
		expect(identityOf(kernel).getState()).toMatchObject({
			authenticated: true,
			profile: PROFILE,
			deviceAuth: { status: "idle" },
		});
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(true);
		await vi.waitFor(() => expect(focusMain).toHaveBeenCalled());
		expect(account.disposed).toHaveBeenCalled();
		expect(tracked.map(({ event }) => event)).toContain("Logged In");
	});

	it("shares one flow between concurrent sign-ins", async () => {
		const { kernel, account } = await boot();
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(false));
		const authorize = vi.spyOn(account, "authorize");

		const first = identityOf(kernel).methods.signIn(undefined);
		const second = identityOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() => expect(identityOf(kernel).getState().deviceAuth.status).toBe("waiting"));
		account.approve();

		await expect(Promise.all([first, second])).resolves.toEqual([
			{ signedIn: true },
			{ signedIn: true },
		]);
		expect(authorize).toHaveBeenCalledOnce();
	});

	it("cancels a sign-in so a later approval can't land", async () => {
		const { kernel, account } = await boot();
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(false));

		const signingIn = identityOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() => expect(identityOf(kernel).getState().deviceAuth.status).toBe("waiting"));
		await identityOf(kernel).methods.cancelSignIn(undefined);

		await expect(signingIn).resolves.toEqual({ signedIn: false });
		expect(identityOf(kernel).getState().deviceAuth).toEqual({ status: "idle" });
		account.approve();
		expect(identityOf(kernel).getState().deviceAuth).toEqual({ status: "idle" });
	});

	it("explains a sign-in that fails", async () => {
		const { kernel, account } = await boot();
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(false));

		const signingIn = identityOf(kernel).methods.signIn(undefined);
		await vi.waitFor(() => expect(identityOf(kernel).getState().deviceAuth.status).toBe("waiting"));
		account.deny("The code expired.");

		await expect(signingIn).resolves.toEqual({ signedIn: false });
		expect(identityOf(kernel).getState().deviceAuth).toEqual({
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
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(false));

		await identityOf(kernel).methods.signIn(undefined);

		expect(identityOf(kernel).getState().deviceAuth).toEqual({
			status: "error",
			error: "Sign-in failed",
		});
	});

	it("signs out even when the credentials are already gone", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.signOutError = new Error("401 Unauthorized");
		const { kernel, tracked } = await boot({ account });
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(true));
		account.authenticated = false;

		await identityOf(kernel).methods.signOut(undefined);

		expect(identityOf(kernel).getState()).toMatchObject({ authenticated: false, profile: null });
		expect(kernel.kernelSdk.context.get(SIGNED_IN_KEY)).toBe(false);
		expect(tracked.map(({ event }) => event)).toContain("Logged Out");
	});

	it("switches organization and reads the account again", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(true));

		await identityOf(kernel).methods.setOrganization({ organizationId: "org-1" });

		expect(account.organizations).toEqual(["org-1"]);
		expect(identityOf(kernel).getState()).toMatchObject({
			profile: { currentOrgId: "org-1" },
			isSwitchingOrg: false,
			orgError: null,
		});
	});

	it("reports a failed organization switch until dismissed", async () => {
		const account = new FakeKiloAccount();
		account.authenticated = true;
		account.setOrganization = async () => {
			throw new Error("Not a member.");
		};
		const { kernel } = await boot({ account });
		await vi.waitFor(() => expect(identityOf(kernel).getState().authenticated).toBe(true));

		await identityOf(kernel).methods.setOrganization({ organizationId: "org-2" });
		expect(identityOf(kernel).getState().orgError).toEqual({
			message: "Not a member.",
			organizationId: "org-2",
		});

		await identityOf(kernel).methods.dismissOrgError(undefined);
		expect(identityOf(kernel).getState().orgError).toBeNull();
	});
});

describe("kilo.account terms", () => {
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
		expect(tracked.filter(({ event }) => event === "Terms Accepted")).toHaveLength(1);
	});

	it("asks again when the terms change", async () => {
		const storage = createMemoryStorage("/data/kilo.account");
		storage.kv<Record<string, unknown>>({ namespace: "terms", defaults: {} }).set({
			version: "2020-01-01",
			acceptedAt: 5,
			linkedAccounts: [],
		});
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
		await termsOf(kernel).methods.accept({ version: KILO_TERMS_VERSION });
		await vi.waitFor(() =>
			expect(tracked.map(({ event }) => event)).toContain("Terms Acceptance Linked"),
		);

		await identityOf(kernel).methods.refresh(undefined);

		expect(tracked.filter(({ event }) => event === "Terms Acceptance Linked")).toHaveLength(1);
		const saved = storage
			.kv<{ linkedAccounts: string[] }>({ namespace: "terms", defaults: { linkedAccounts: [] } })
			.snapshot();
		const hash = createHash("sha256").update("kilo-terms:ada@example.com").digest("hex");
		expect(saved.linkedAccounts).toEqual([hash]);
		expect(JSON.stringify(saved)).not.toContain("ada@example.com");
	});

	it("keeps the terms origin's kilo-ui accepted, without reporting a new acceptance", async () => {
		const origin = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: ["old"] };
		const { kernel, tracked, storage } = await boot({
			readOriginTerms: () => JSON.stringify(origin),
		});

		expect(termsOf(kernel).getState()).toEqual({
			version: KILO_TERMS_VERSION,
			accepted: true,
			acceptedAt: 42,
		});
		expect(kernel.kernelSdk.context.get(TERMS_ACCEPTED_KEY)).toBe(true);
		await termsOf(kernel).methods.accept({ version: KILO_TERMS_VERSION });
		expect(tracked.filter(({ event }) => event === "Terms Accepted")).toHaveLength(0);

		const unaccepted = { version: null, acceptedAt: null, linkedAccounts: [] };
		const second = await boot({ storage, readOriginTerms: () => JSON.stringify(unaccepted) });
		expect(termsOf(second.kernel).getState().acceptedAt).toBe(42);
	});

	it("doesn't link an account origin's kilo-ui already linked", async () => {
		// Origin keyed accounts by `userId || email.toLowerCase()`; its session never carried a userId.
		const originKey = createHash("sha256").update("kilo-terms:ada@example.com").digest("hex");
		const origin = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: [originKey] };
		const account = new FakeKiloAccount();
		account.authenticated = true;
		const { kernel, tracked } = await boot({
			account,
			readOriginTerms: () => JSON.stringify(origin),
		});

		await identityOf(kernel).methods.refresh(undefined);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(termsOf(kernel).getState().accepted).toBe(true);
		expect(tracked.map(({ event }) => event)).not.toContain("Terms Acceptance Linked");
	});

	it("tries origin's terms again next launch when they can't be read", async () => {
		const storage = createMemoryStorage("/data/kilo.account");
		const first = await boot({
			storage,
			readOriginTerms: () => {
				throw new Error("EBUSY");
			},
		});
		expect(termsOf(first.kernel).getState().accepted).toBe(false);

		const origin = { version: KILO_TERMS_VERSION, acceptedAt: 42, linkedAccounts: [] };
		const second = await boot({ storage, readOriginTerms: () => JSON.stringify(origin) });

		expect(termsOf(second.kernel).getState().accepted).toBe(true);
	});

	it("treats the terms as accepted for packaged e2e runs", async () => {
		vi.stubEnv("KILO_SKIP_ONBOARDING", "1");
		const { kernel, storage } = await boot();

		expect(termsOf(kernel).getState().accepted).toBe(true);
		expect(kernel.kernelSdk.context.get(TERMS_ACCEPTED_KEY)).toBe(true);
		expect(storage.saved.size).toBe(0);
	});
});
