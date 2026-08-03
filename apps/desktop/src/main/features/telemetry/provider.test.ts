import { describe, expect, it, vi } from "vitest";

import { AnacondaOtelProvider, type OtelFns } from "./provider.js";
import type { TelemetryAuthAdapter, TelemetryConfig, TelemetryEntry } from "./types.js";

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const baseConfig: TelemetryConfig = {
	authUrl: "https://metrics.example.com/v1/logs",
	nonAuthUrl: "https://public.example.com/v1/logs",
	exportIntervalMs: 3000,
	environmentAttribute: "test",
	serviceId: "anaconda-agentic-desktop",
	serviceVersion: "1.2.3",
};

interface OtelSpy {
	otel: OtelFns;
	sendEvent: ReturnType<typeof vi.fn>;
	setAttributes: ReturnType<typeof vi.fn>;
	configs: Array<{ url: URL; token: string | undefined }>;
}

function createOtelSpy(sendOk = true): OtelSpy {
	const configs: OtelSpy["configs"] = [];
	const setAttributes = vi.fn();

	class FakeConfiguration {
		constructor(
			public url: URL,
			public token?: string,
		) {
			configs.push({ url, token });
		}
		setLoggingExportIntervalMs() {
			return this;
		}
		setDebugState() {
			return this;
		}
	}

	class FakeResourceAttributes {
		constructor(
			public serviceName: string,
			public serviceVersion: string,
		) {}
		setAttributes(attrs: Record<string, unknown>) {
			setAttributes(attrs);
			return this;
		}
	}

	const sendEvent = vi.fn(() => sendOk);

	return {
		otel: {
			initializeTelemetry: vi.fn(() => true),
			sendEvent: sendEvent as unknown as OtelFns["sendEvent"],
			changeSignalConnection: vi.fn(async () => true),
			Configuration: FakeConfiguration as unknown as OtelFns["Configuration"],
			ResourceAttributes: FakeResourceAttributes as unknown as OtelFns["ResourceAttributes"],
		},
		sendEvent,
		setAttributes,
		configs,
	};
}

function fakeAuth(overrides: Partial<TelemetryAuthAdapter> = {}): TelemetryAuthAdapter & {
	emitChange: () => void;
} {
	const listeners = new Set<() => void>();
	return {
		getIdentity: overrides.getIdentity ?? (async () => ({ isEmployee: false })),
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

function provider(spy: OtelSpy, auth: TelemetryAuthAdapter, readMachineId?: () => Promise<string>) {
	return new AnacondaOtelProvider({
		auth,
		config: baseConfig,
		logger: silentLogger,
		otel: spy.otel,
		readMachineId: readMachineId ?? (async () => "raw-machine-id"),
	});
}

describe("AnacondaOtelProvider", () => {
	it("lazily initializes once under concurrent sends", async () => {
		const spy = createOtelSpy();
		const p = provider(spy, fakeAuth());

		await Promise.all([p.send(entry()), p.send(entry()), p.send(entry())]);

		expect(spy.otel.initializeTelemetry).toHaveBeenCalledTimes(1);
		expect(spy.sendEvent).toHaveBeenCalledTimes(3);
	});

	it("selects the anonymous endpoint when there is no api key", async () => {
		const spy = createOtelSpy();
		await provider(spy, fakeAuth({ getApiKey: async () => null })).send(entry());

		expect(spy.configs[0]?.url.href).toBe("https://public.example.com/v1/logs");
		expect(spy.configs[0]?.token).toBeUndefined();
	});

	it("selects the authenticated endpoint when an api key is present", async () => {
		const spy = createOtelSpy();
		await provider(spy, fakeAuth({ getApiKey: async () => "api-key" })).send(entry());

		expect(spy.configs[0]?.url.href).toBe("https://metrics.example.com/v1/logs");
		expect(spy.configs[0]?.token).toBe("api-key");
	});

	it("re-initializes the connection when the api key changes", async () => {
		const spy = createOtelSpy();
		let token: string | null = null;
		const auth = fakeAuth({ getApiKey: async () => token });
		const p = provider(spy, auth);

		await p.send(entry()); // anonymous init
		token = "api-key";
		await p.send(entry({ userId: "u1" })); // key changed → re-init

		expect(spy.otel.changeSignalConnection).toHaveBeenCalledWith(
			"logging",
			expect.objectContaining({
				endpoint: expect.any(URL),
				authToken: "api-key",
				userId: "u1",
			}),
		);
	});

	it("includes identity + install attributes on the OTEL resource", async () => {
		const spy = createOtelSpy();
		await provider(spy, fakeAuth({ getApiKey: async () => "api-key" })).send(
			entry({
				userId: "u1",
				isEmployee: true,
				cohortId: 42,
				subscription: "business_subscription",
			}),
		);

		expect(spy.setAttributes.mock.calls[0]?.[0]).toMatchObject({
			userId: "u1",
			installationId: "install-1",
			environment: "test",
			platform: "desktop-gui",
			parameters: expect.objectContaining({
				machineId: expect.any(String),
				service_id: "anaconda-agentic-desktop",
				cohortId: 42,
				is_anaconda_employee: true,
				subscription: "business_subscription",
			}),
		});
	});

	it("falls back to a hostname-based hash when the machine-id read rejects", async () => {
		const spy = createOtelSpy();
		await provider(spy, fakeAuth(), async () => {
			throw new Error("blocked");
		}).send(entry());

		const machineId = spy.setAttributes.mock.calls[0]?.[0].parameters.machineId;
		expect(machineId).toMatch(/^[0-9a-f]{64}$/);
	});

	it("never throws when send fails; logs instead", async () => {
		const spy = createOtelSpy(false);
		const errorLogger = { ...silentLogger, error: vi.fn() };
		const p = new AnacondaOtelProvider({
			auth: fakeAuth(),
			config: baseConfig,
			logger: errorLogger,
			otel: spy.otel,
			readMachineId: async () => "raw",
		});

		await expect(p.send(entry())).resolves.toBeUndefined();
		expect(errorLogger.error).toHaveBeenCalled();
	});

	it("never throws when initialization rejects", async () => {
		const spy = createOtelSpy();
		spy.otel.initializeTelemetry = vi.fn(() => {
			throw new Error("init boom");
		}) as unknown as OtelFns["initializeTelemetry"];
		const errorLogger = { ...silentLogger, error: vi.fn() };

		const p = new AnacondaOtelProvider({
			auth: fakeAuth(),
			config: baseConfig,
			logger: errorLogger,
			otel: spy.otel,
			readMachineId: async () => "raw",
		});

		await expect(p.send(entry())).resolves.toBeUndefined();
		expect(errorLogger.error).toHaveBeenCalled();
	});

	it("stops listening to auth changes on dispose", async () => {
		const spy = createOtelSpy();
		const auth = fakeAuth();
		const p = provider(spy, auth);

		await p.dispose();
		auth.emitChange();

		await p.send(entry());
		expect(spy.otel.changeSignalConnection).not.toHaveBeenCalled();
	});

	it("falls back to localhost when no endpoints are configured", async () => {
		const spy = createOtelSpy();
		const warn = vi.fn();
		const p = new AnacondaOtelProvider({
			auth: fakeAuth(),
			config: { serviceId: "svc", serviceVersion: "1.0.0" },
			logger: { ...silentLogger, warn },
			otel: spy.otel,
			readMachineId: async () => "raw",
		});

		await p.send(entry());

		expect(spy.configs[0]?.url.href).toBe("http://localhost:4318/v1/logs");
		expect(warn).toHaveBeenCalled();
	});

	it("skips the export-interval config when it is unset", async () => {
		const spy = createOtelSpy();
		const setLoggingExportIntervalMs = vi.fn();

		class Config {
			constructor(
				public url: URL,
				public token?: string,
			) {
				spy.configs.push({ url, token });
			}
			setLoggingExportIntervalMs = setLoggingExportIntervalMs;
			setDebugState() {
				return this;
			}
		}
		const otel = { ...spy.otel, Configuration: Config as unknown as OtelFns["Configuration"] };
		const p = new AnacondaOtelProvider({
			auth: fakeAuth(),
			config: { serviceId: "svc", serviceVersion: "1.0.0", nonAuthUrl: "https://x.test/v1/logs" },
			logger: silentLogger,
			otel,
			readMachineId: async () => "raw",
		});

		await p.send(entry());
		expect(setLoggingExportIntervalMs).not.toHaveBeenCalled();
	});

	it("re-initializes to the no-user state after losing the user", async () => {
		const spy = createOtelSpy();
		let token: string | null = "api-key";
		const auth = fakeAuth({ getApiKey: async () => token });
		const p = provider(spy, auth);

		await p.send(entry({ userId: "u1" }));
		token = null;
		await p.send(entry());

		expect(spy.otel.changeSignalConnection).toHaveBeenCalledWith(
			"logging",
			expect.not.objectContaining({ userId: expect.anything() }),
		);
	});
});
