import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelemetryService, deriveTelemetryIdentity, type TelemetryPreferences } from "./service.js";
import type { TelemetryAuth, TelemetryProvider } from "./types.js";

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
	appRunId?: string;
}): TelemetryService {
	return new TelemetryService({
		provider: options.provider,
		auth: options.auth ?? fakeAuth(),
		preferences: options.preferences ?? preferences(),
		logger: silentLogger,
		appVersion: options.appVersion ?? "0.0.0",
		appRunId: options.appRunId ?? "run-1",
	});
}

describe("TelemetryService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("drops events when data collection is disabled", async () => {
		const provider = fakeProvider();
		await service({ provider, preferences: preferences({ allowDataCollection: false }) }).track({
			event: "Page Visit",
			data: {},
		});

		expect(provider.track).not.toHaveBeenCalled();
	});

	it("assembles an entry with resolved identity and forwards it", async () => {
		vi.spyOn(Date, "now").mockReturnValue(0);
		const provider = fakeProvider();
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
		});

		await service({ provider, auth }).track({
			event: "Logged In",
			data: { email_domain: "anaconda.com" },
		});

		expect(provider.track).toHaveBeenCalledWith({
			event: "Logged In",
			data: { email_domain: "anaconda.com" },
			installationId: "install-1",
			appRunId: "run-1",
			email: "dev@anaconda.com",
			isEmployee: true,
			cohortId: 0,
		});
	});

	it("omits absent identity fields from the entry", async () => {
		const provider = fakeProvider();
		await service({ provider }).track({ event: "Page Visit", data: { path: "/" } });

		expect(provider.track).toHaveBeenCalledWith({
			event: "Page Visit",
			data: { path: "/" },
			installationId: "install-1",
			appRunId: "run-1",
			isEmployee: false,
		});
	});

	it("sends an anonymous entry when anonymize is 'always' (no session read)", async () => {
		const getSession = vi.fn(async () => ({ status: "anonymous" as const }));
		const provider = fakeProvider();
		await service({ provider, auth: fakeAuth({ getSession }) }).track({
			event: "Logged In",
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
			service({ provider }).track({ event: "Page Visit", data: {} }),
		).resolves.toBeUndefined();
	});

	it("fires the bootstrap event on initialize", async () => {
		const provider = fakeProvider();
		await service({ provider, appVersion: "1.2.3" }).initialize();

		const entry = provider.track.mock.calls[0]?.[0];
		expect(entry).toMatchObject({
			event: "Desktop Initialized",
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
	beforeEach(() => {
		vi.spyOn(Date, "now").mockReturnValue(0);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("resolves identity for an authenticated anaconda employee", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u1", email: "dev@anaconda.com" },
			}),
		});

		expect(await deriveTelemetryIdentity(auth, "never")).toEqual({
			email: "dev@anaconda.com",
			isEmployee: true,
			cohortId: 0,
		});
	});

	it("resolves identity for a non-anaconda email", async () => {
		const auth = fakeAuth({
			getSession: async () => ({
				status: "authenticated",
				user: { userId: "u2", email: "person@example.com" },
			}),
		});

		expect(await deriveTelemetryIdentity(auth, "never")).toEqual({
			email: "person@example.com",
			isEmployee: false,
			cohortId: 0,
		});
	});

	it("returns the anonymous identity when anonymize is 'always'", async () => {
		const getSession = vi.fn(async () => ({
			status: "authenticated" as const,
			user: { userId: "u1", email: "dev@anaconda.com" },
		}));

		expect(await deriveTelemetryIdentity(fakeAuth({ getSession }), "always")).toEqual({
			isEmployee: false,
		});
		expect(getSession).not.toHaveBeenCalled();
	});

	it("returns the anonymous identity for an anonymous session", async () => {
		expect(await deriveTelemetryIdentity(fakeAuth(), "never")).toEqual({ isEmployee: false });
	});

	it("returns the anonymous identity when getSession throws", async () => {
		const auth = fakeAuth({
			getSession: async () => {
				throw new Error("session error");
			},
		});

		expect(await deriveTelemetryIdentity(auth, "never")).toEqual({ isEmployee: false });
	});

	it("treats an authenticated session without an email as anonymous", async () => {
		const auth = fakeAuth({
			getSession: async () => ({ status: "authenticated", user: { userId: "u3" } }),
		});

		expect(await deriveTelemetryIdentity(auth, "never")).toEqual({ isEmployee: false });
	});
});

describe("TelemetryService.create", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("assembles a service from the auth slice, preferences, and env", () => {
		vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");

		const svc = TelemetryService.create({
			auth: fakeAuth(),
			preferences: preferences(),
			appVersion: "1.2.3",
			environment: "preview",
		});

		expect(svc).toBeInstanceOf(TelemetryService);
	});

	it("tolerates an unset host override", () => {
		const svc = TelemetryService.create({
			auth: fakeAuth(),
			preferences: preferences({ allowDataCollection: false }),
			appVersion: "1.2.3",
			environment: "development",
		});

		expect(svc).toBeInstanceOf(TelemetryService);
	});
});
