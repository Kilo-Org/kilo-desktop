import { afterEach, describe, expect, it, vi } from "vitest";

import { TelemetryService, type TelemetryPreferences } from "./service.js";
import type { AuthSessionSlice } from "./auth-adapter.js";
import type { TelemetryAuthAdapter, TelemetryProvider } from "./types.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function fakeProvider(send = vi.fn(async () => {})): TelemetryProvider & {
	send: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
} {
	return { send, dispose: vi.fn(async () => {}) } as TelemetryProvider & {
		send: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
}

function fakeAuth(overrides: Partial<TelemetryAuthAdapter> = {}): TelemetryAuthAdapter {
	return {
		getIdentity: overrides.getIdentity ?? (async () => ({ isEmployee: false })),
		getApiKey: overrides.getApiKey ?? (async () => null),
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
	auth?: TelemetryAuthAdapter;
	preferences?: TelemetryPreferences;
	appVersion?: string;
}): TelemetryService {
	return TelemetryService.withDependencies({
		provider: options.provider,
		auth: options.auth ?? fakeAuth(),
		preferences: options.preferences ?? preferences(),
		logger: silentLogger,
		...(options.appVersion ? { appVersion: options.appVersion } : {}),
	});
}

describe("TelemetryService", () => {
	it("drops events when data collection is disabled", async () => {
		const provider = fakeProvider();
		await service({ provider, preferences: preferences({ allowDataCollection: false }) }).track(
			{
				event: "PAGE_VISIT",
				data: {},
			},
		);

		expect(provider.send).not.toHaveBeenCalled();
	});

	it("assembles an entry with resolved identity and forwards it", async () => {
		const provider = fakeProvider();
		const auth = fakeAuth({
			getIdentity: async () => ({
				userId: "u1",
				isEmployee: true,
				cohortId: 7,
				subscription: "business_subscription",
			}),
		});

		await service({ provider, auth }).track({
			event: "LOGGED_IN",
			data: { email_domain: "anaconda.com" },
		});

		expect(provider.send).toHaveBeenCalledWith({
			event: "LOGGED_IN",
			data: { email_domain: "anaconda.com" },
			installationId: "install-1",
			isEmployee: true,
			userId: "u1",
			cohortId: 7,
			subscription: "business_subscription",
		});
	});

	it("omits absent identity fields from the entry", async () => {
		const provider = fakeProvider();
		await service({ provider }).track({ event: "PAGE_VISIT", data: { path: "/" } });

		expect(provider.send).toHaveBeenCalledWith({
			event: "PAGE_VISIT",
			data: { path: "/" },
			installationId: "install-1",
			isEmployee: false,
		});
	});

	it("passes the anonymize option through to the auth adapter", async () => {
		const getIdentity = vi.fn(async () => ({ isEmployee: false }));
		await service({ provider: fakeProvider(), auth: fakeAuth({ getIdentity }) }).track({
			event: "LOGGED_IN",
			data: {},
			options: { anonymize: "always" },
		});

		expect(getIdentity).toHaveBeenCalledWith("always");
	});

	it("defaults the anonymize option to 'never'", async () => {
		const getIdentity = vi.fn(async () => ({ isEmployee: false }));
		await service({ provider: fakeProvider(), auth: fakeAuth({ getIdentity }) }).track({
			event: "PAGE_VISIT",
			data: {},
		});

		expect(getIdentity).toHaveBeenCalledWith("never");
	});

	it("swallows a provider failure", async () => {
		const provider = fakeProvider(
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);
		const errorLogger = { ...silentLogger, error: vi.fn() };
		const svc = TelemetryService.withDependencies({
			provider,
			auth: fakeAuth(),
			preferences: preferences(),
			logger: errorLogger,
		});

		await expect(svc.track({ event: "PAGE_VISIT", data: {} })).resolves.toBeUndefined();
		expect(errorLogger.error).toHaveBeenCalled();
	});

	it("fires the bootstrap event on initialize", async () => {
		const provider = fakeProvider();
		await service({ provider, appVersion: "1.2.3" }).initialize();

		const entry = provider.send.mock.calls[0]?.[0];
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

describe("TelemetryService.create", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function fakeAuthSlice(): AuthSessionSlice {
		return {
			getSession: async () => ({ status: "anonymous" }),
			getApiKey: async () => null,
			getUserInfo: async () => [],
			onChanged: () => () => {},
		};
	}

	it("assembles a service from the auth slice, preferences, and env", () => {
		vi.stubEnv("VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE", "test");
		vi.stubEnv("VITE_ANACONDA_LOGGING_AUTH_URL", "https://auth.test/v1/logs");
		vi.stubEnv("VITE_ANACONDA_LOGGING_NON_AUTH_URL", "https://anon.test/v1/logs");
		vi.stubEnv("VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS", "15000");

		const svc = TelemetryService.create({
			auth: fakeAuthSlice(),
			preferences: { allowDataCollection: true, getInstallationId: () => "install-1" },
			appVersion: "1.2.3",
			serviceId: "anaconda-agentic-desktop",
		});

		expect(svc).toBeInstanceOf(TelemetryService);
	});

	it("tolerates unset / non-numeric env values", () => {
		vi.stubEnv("VITE_ANACONDA_LOGGING_AUTH_URL", "");
		vi.stubEnv("VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS", "not-a-number");

		const svc = TelemetryService.create({
			auth: fakeAuthSlice(),
			preferences: { allowDataCollection: false, getInstallationId: () => "install-1" },
			appVersion: "1.2.3",
			serviceId: "svc",
		});

		expect(svc).toBeInstanceOf(TelemetryService);
	});
});
