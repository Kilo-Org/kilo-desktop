import { afterEach, describe, expect, it, vi } from "vitest";

import { TelemetryService, deriveTelemetryIdentity, type TelemetryPreferences } from "./service.js";
import type { TelemetryAuth, TelemetryProvider } from "./types.js";

vi.mock("anaconda-opentelemetry", () => ({
	initializeTelemetry: vi.fn(() => true),
	sendEvent: vi.fn(() => true),
	changeSignalConnection: vi.fn(async () => true),
	Configuration: class {
		setLoggingExportIntervalMs() {
			return this;
		}
		setDebugState() {
			return this;
		}
	},
	ResourceAttributes: class {
		setAttributes() {
			return this;
		}
	},
}));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function fakeProvider(track = vi.fn(async () => {})): TelemetryProvider & {
	track: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
} {
	return { track, dispose: vi.fn(async () => {}) } as TelemetryProvider & {
		track: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
}

function fakeAuth(overrides: Partial<TelemetryAuth> = {}): TelemetryAuth {
	return {
		getSession: overrides.getSession ?? (async () => ({ status: "anonymous" })),
		getApiKey: overrides.getApiKey ?? (async () => null),
		getUserInfo: overrides.getUserInfo ?? (async () => []),
		onChanged: overrides.onChanged ?? (() => () => {}),
	};
}

function preferences(overrides: Partial<TelemetryPreferences> = {}): TelemetryPreferences {
	return {
		allowDataCollection: overrides.allowDataCollection ?? true,
		getInstallationId: overrides.getInstallationId ?? (() => "install-1"),
	};
}

function service(options: {
	provider: TelemetryProvider;
	auth?: TelemetryAuth;
	preferences?: TelemetryPreferences;
	appVersion?: string;
	now?: () => number;
}): TelemetryService {
	return new TelemetryService({
		provider: options.provider,
		auth: options.auth ?? fakeAuth(),
		preferences: options.preferences ?? preferences(),
		logger: silentLogger,
		appVersion: options.appVersion ?? "0.0.0",
		now: options.now ?? (() => 0),
	});
}

describe("TelemetryService", () => {
	it("drops events when data collection is disabled", async () => {
		const provider = fakeProvider();
		await service({ provider, preferences: preferences({ allowDataCollection: false }) }).track({
			event: "PAGE_VISIT",
			data: {},
		});

		expect(provider.track).not.toHaveBeenCalled();
	});

	it("assembles an entry with resolved identity and forwards it", async () => {
		const provider = fakeProvider();
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo: async () => [{ id: "business_subscription.org", group: "subscriptions" }],
		});

		await service({ provider, auth }).track({
			event: "LOGGED_IN",
			data: { email_domain: "anaconda.com" },
		});

		expect(provider.track).toHaveBeenCalledWith({
			event: "LOGGED_IN",
			data: { email_domain: "anaconda.com" },
			installationId: "install-1",
			isEmployee: true,
			userId: "u1",
			cohortId: 0,
			subscription: "business_subscription",
		});
	});

	it("omits absent identity fields from the entry", async () => {
		const provider = fakeProvider();
		await service({ provider }).track({ event: "PAGE_VISIT", data: { path: "/" } });

		expect(provider.track).toHaveBeenCalledWith({
			event: "PAGE_VISIT",
			data: { path: "/" },
			installationId: "install-1",
			isEmployee: false,
		});
	});

	it("sends an anonymous entry when anonymize is 'always' (no session read)", async () => {
		const getSession = vi.fn(async () => ({ status: "anonymous" as const }));
		const provider = fakeProvider();
		await service({ provider, auth: fakeAuth({ getSession }) }).track({
			event: "LOGGED_IN",
			data: {},
			options: { anonymize: "always" },
		});

		expect(getSession).not.toHaveBeenCalled();
		expect(provider.track).toHaveBeenCalledWith(expect.objectContaining({ isEmployee: false }));
	});

	it("swallows a provider failure", async () => {
		const provider = fakeProvider(
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);

		await expect(
			service({ provider }).track({ event: "PAGE_VISIT", data: {} }),
		).resolves.toBeUndefined();
	});

	it("fires the bootstrap event on initialize", async () => {
		const provider = fakeProvider();
		await service({ provider, appVersion: "1.2.3" }).initialize();

		const entry = provider.track.mock.calls[0]?.[0];
		expect(entry).toMatchObject({
			event: "DESKTOP_INITIALIZED",
			data: expect.objectContaining({ version: "1.2.3", platform: process.platform }),
		});
	});

	it("delegates dispose to the provider", async () => {
		const provider = fakeProvider();
		await service({ provider }).dispose();
		expect(provider.dispose).toHaveBeenCalled();
	});
});

describe("deriveTelemetryIdentity", () => {
	const now = () => 0;

	it("resolves identity for an authenticated anaconda employee with a subscription", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo: async () => [{ id: "business_subscription.org", group: "subscriptions" }],
		});

		expect(await deriveTelemetryIdentity(auth, "never", now)).toEqual({
			userId: "u1",
			isEmployee: true,
			cohortId: 0,
			subscription: "business_subscription",
		});
	});

	it("marks a non-anaconda email as free tier without attributes", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u2", email: "person@example.com" },
			}),
		});

		expect(await deriveTelemetryIdentity(auth, "never", now)).toEqual({
			userId: "u2",
			isEmployee: false,
			cohortId: 0,
			subscription: "free_subscription",
		});
	});

	it("returns the anonymous identity when anonymize is 'always' (no userinfo call)", async () => {
		const getUserInfo = vi.fn(async () => []);
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo,
		});

		expect(await deriveTelemetryIdentity(auth, "always", now)).toEqual({ isEmployee: false });
		expect(getUserInfo).not.toHaveBeenCalled();
	});

	it("returns the anonymous identity for an anonymous session", async () => {
		expect(await deriveTelemetryIdentity(fakeAuth(), "never", now)).toEqual({ isEmployee: false });
	});

	it("omits subscription when getUserInfo throws (never throws)", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
			getUserInfo: async () => {
				throw new Error("boom");
			},
		});

		const identity = await deriveTelemetryIdentity(auth, "never", now);
		expect(identity.subscription).toBeUndefined();
		expect(identity.userId).toBe("u1");
	});

	it("returns the anonymous identity when getSession throws", async () => {
		const auth = fakeAuth({
			getSession: async () => {
				throw new Error("session error");
			},
		});

		expect(await deriveTelemetryIdentity(auth, "never", now)).toEqual({ isEmployee: false });
	});

	it("treats a user without an email as a non-employee", async () => {
		const auth = fakeAuth({
			getSession: async () => ({ status: "authenticated", user: { userId: "u3" } }),
		});

		const identity = await deriveTelemetryIdentity(auth, "never", now);
		expect(identity.isEmployee).toBe(false);
		expect(identity.userId).toBe("u3");
	});
});

describe("TelemetryService.create", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("assembles a service from the auth slice, preferences, and env", () => {
		vi.stubEnv("VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE", "test");
		vi.stubEnv("VITE_ANACONDA_LOGGING_AUTH_URL", "https://auth.test/v1/logs");
		vi.stubEnv("VITE_ANACONDA_LOGGING_NON_AUTH_URL", "https://anon.test/v1/logs");
		vi.stubEnv("VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS", "15000");

		const svc = TelemetryService.create({
			auth: fakeAuth(),
			preferences: preferences(),
			appVersion: "1.2.3",
			serviceId: "anaconda-agentic-desktop",
		});

		expect(svc).toBeInstanceOf(TelemetryService);
	});

	it("tolerates unset / non-numeric env values", () => {
		vi.stubEnv("VITE_ANACONDA_LOGGING_AUTH_URL", "");
		vi.stubEnv("VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS", "not-a-number");

		const svc = TelemetryService.create({
			auth: fakeAuth(),
			preferences: preferences({ allowDataCollection: false }),
			appVersion: "1.2.3",
			serviceId: "svc",
		});

		expect(svc).toBeInstanceOf(TelemetryService);
	});
});
