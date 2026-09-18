import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnacondaOtelProvider } from "./provider.js";
import type { TelemetryConfig, TelemetryEntry, TelemetryProviderAuth } from "./types.js";

const otel = vi.hoisted(() => {
	const loggingEndpoints: Array<{ url: URL; token: string | undefined }> = [];
	const sendEventCalls: Array<{
		eventName: string;
		payload: unknown;
		attributes: Record<string, unknown>;
	}> = [];
	return {
		loggingEndpoints,
		sendEventCalls,
		setLoggingExportIntervalMs: vi.fn(),
		setAttributes: vi.fn(),
		sendEvent: vi.fn(() => true),
		initializeTelemetry: vi.fn(() => true),
		changeSignalConnection: vi.fn(async () => true),
	};
});

vi.mock("anaconda-opentelemetry", () => {
	class Configuration {
		setLoggingEndpoint(url: URL, token?: string) {
			otel.loggingEndpoints.push({ url, token });
			return this;
		}
		setLoggingExportIntervalMs(...args: unknown[]) {
			otel.setLoggingExportIntervalMs(...args);
			return this;
		}
		setDebugState() {
			return this;
		}
	}
	class ResourceAttributes {
		constructor(
			public serviceName: string,
			public serviceVersion: string,
		) {}
		setAttributes(attrs: Record<string, unknown>) {
			otel.setAttributes(attrs);
			return this;
		}
	}
	return {
		initializeTelemetry: otel.initializeTelemetry,
		sendEvent: (args: {
			eventName: string;
			payload: unknown;
			attributes: Record<string, unknown>;
		}) => {
			otel.sendEventCalls.push(args);
			return otel.sendEvent();
		},
		changeSignalConnection: otel.changeSignalConnection,
		Configuration,
		ResourceAttributes,
	};
});

const { loggingEndpoints, sendEventCalls } = otel;
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const baseConfig: TelemetryConfig = {
	authUrl: "https://metrics.example.com/v1/logs",
	nonAuthUrl: "https://public.example.com/v1/logs",
	exportIntervalMs: 3000,
	environmentAttribute: "test",
	serviceId: "kilo-desktop",
	serviceVersion: "1.2.3",
};

function fakeAuth(overrides: Partial<TelemetryProviderAuth> = {}): TelemetryProviderAuth & {
	emitChange: () => void;
} {
	const listeners = new Set<() => void>();
	return {
		getApiKey: overrides.getApiKey ?? (async () => null),
		onChanged:
			overrides.onChanged ??
			((listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			}),
		emitChange() {
			for (const listener of listeners) listener();
		},
	};
}

function entry(overrides: Partial<TelemetryEntry> = {}): TelemetryEntry {
	return {
		event: "DESKTOP_INITIALIZED",
		data: { foo: "bar" },
		installationId: "install-1",
		isEmployee: false,
		...overrides,
	};
}

function provider(auth: TelemetryProviderAuth, config: TelemetryConfig = baseConfig) {
	return new AnacondaOtelProvider({ auth, config, logger: silentLogger });
}

beforeEach(() => {
	vi.clearAllMocks();
	loggingEndpoints.length = 0;
	sendEventCalls.length = 0;
	otel.sendEvent.mockReturnValue(true);
	otel.initializeTelemetry.mockReturnValue(true);
});

describe("AnacondaOtelProvider", () => {
	it("lazily initializes once under concurrent sends", async () => {
		const p = provider(fakeAuth());

		await Promise.all([p.track(entry()), p.track(entry()), p.track(entry())]);

		expect(otel.initializeTelemetry).toHaveBeenCalledTimes(1);
		expect(sendEventCalls).toHaveLength(3);
	});

	it("selects the anonymous endpoint when there is no api key", async () => {
		await provider(fakeAuth({ getApiKey: async () => null })).track(entry());

		expect(loggingEndpoints[0]?.url.href).toBe("https://public.example.com/v1/logs");
		expect(loggingEndpoints[0]?.token).toBeUndefined();
	});

	it("selects the authenticated endpoint when an api key is present", async () => {
		await provider(fakeAuth({ getApiKey: async () => "api-key" })).track(entry());

		expect(loggingEndpoints[0]?.url.href).toBe("https://metrics.example.com/v1/logs");
		expect(loggingEndpoints[0]?.token).toBe("api-key");
	});

	it("re-initializes the connection when the api key changes", async () => {
		let token: string | null = null;
		const p = provider(fakeAuth({ getApiKey: async () => token }));

		await p.track(entry());
		token = "api-key";
		await p.track(entry({ userId: "u1" }));

		expect(otel.changeSignalConnection).toHaveBeenCalledWith(
			"logging",
			expect.objectContaining({
				endpoint: expect.any(URL),
				authToken: "api-key",
				userId: "u1",
			}),
		);
	});

	it("includes identity + install attributes on the OTEL resource", async () => {
		await provider(fakeAuth({ getApiKey: async () => "api-key" })).track(
			entry({
				userId: "u1",
				isEmployee: true,
				cohortId: 42,
				subscription: "business_subscription",
			}),
		);

		expect(otel.setAttributes.mock.calls[0]?.[0]).toMatchObject({
			userId: "u1",
			installationId: "install-1",
			environment: "test",
			platform: "desktop-gui",
			parameters: expect.objectContaining({
				machineId: expect.any(String),
				service_id: "kilo-desktop",
				cohortId: 42,
				is_anaconda_employee: true,
				subscription: "business_subscription",
			}),
		});
	});

	it("passes subscription, cohortId, and is_anaconda_employee as event attributes", async () => {
		await provider(fakeAuth()).track(
			entry({ isEmployee: true, cohortId: 42, subscription: "business_subscription" }),
		);

		expect(sendEventCalls[0]).toMatchObject({
			eventName: "DESKTOP_INITIALIZED",
			attributes: {
				subscription: "business_subscription",
				cohortId: 42,
				is_anaconda_employee: true,
			},
		});
	});

	it("omits absent identity fields from the event attributes", async () => {
		await provider(fakeAuth()).track(entry());

		expect(sendEventCalls[0]?.attributes).toEqual({});
	});

	it("never throws when send fails; resolves instead", async () => {
		otel.sendEvent.mockReturnValue(false);
		await expect(provider(fakeAuth()).track(entry())).resolves.toBeUndefined();
	});

	it("never throws when initialization rejects", async () => {
		otel.initializeTelemetry.mockImplementation(() => {
			throw new Error("init boom");
		});
		await expect(provider(fakeAuth()).track(entry())).resolves.toBeUndefined();
	});

	it("stops listening to auth changes on dispose", async () => {
		const auth = fakeAuth();
		const p = provider(auth);

		await p.track(entry());
		await p.dispose();
		auth.emitChange();
		await p.track(entry());

		expect(otel.changeSignalConnection).not.toHaveBeenCalled();
	});

	it("falls back to localhost when no endpoints are configured", async () => {
		const p = new AnacondaOtelProvider({
			auth: fakeAuth(),
			config: { serviceId: "svc", serviceVersion: "1.0.0" },
			logger: silentLogger,
		});

		await p.track(entry());

		expect(loggingEndpoints[0]?.url.href).toBe("http://localhost:4318/v1/logs");
	});

	it("skips the export-interval config when it is unset", async () => {
		const p = new AnacondaOtelProvider({
			auth: fakeAuth(),
			config: { serviceId: "svc", serviceVersion: "1.0.0", nonAuthUrl: "https://x.test/v1/logs" },
			logger: silentLogger,
		});

		await p.track(entry());
		expect(otel.setLoggingExportIntervalMs).not.toHaveBeenCalled();
	});

	it("re-initializes to the no-user state after losing the user", async () => {
		let token: string | null = "api-key";
		const p = provider(fakeAuth({ getApiKey: async () => token }));

		await p.track(entry({ userId: "u1" }));
		token = null;
		await p.track(entry());

		expect(otel.changeSignalConnection).toHaveBeenCalledWith(
			"logging",
			expect.not.objectContaining({ userId: expect.anything() }),
		);
	});

	it("does not re-initialize on a repeated anonymous send", async () => {
		const p = provider(fakeAuth({ getApiKey: async () => null }));

		await p.track(entry());
		await p.track(entry());

		expect(otel.initializeTelemetry).toHaveBeenCalledTimes(1);
		expect(otel.changeSignalConnection).not.toHaveBeenCalled();
	});

	it("re-initializes once under concurrent sends that change the connection", async () => {
		let token: string | null = null;
		const p = provider(fakeAuth({ getApiKey: async () => token }));

		await p.track(entry());
		token = "api-key";
		await Promise.all([
			p.track(entry({ userId: "u1" })),
			p.track(entry({ userId: "u1" })),
			p.track(entry({ userId: "u1" })),
		]);

		expect(otel.changeSignalConnection).toHaveBeenCalledTimes(1);
		expect(sendEventCalls).toHaveLength(4);
	});

	it("re-initializes after an auth onChanged event even if identity is unchanged", async () => {
		const auth = fakeAuth({ getApiKey: async () => null });
		const p = provider(auth);

		await p.track(entry());
		auth.emitChange();
		await p.track(entry());

		expect(otel.changeSignalConnection).toHaveBeenCalledTimes(1);
	});
});
