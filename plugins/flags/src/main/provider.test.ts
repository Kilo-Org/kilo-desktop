import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	LDClient,
	LDContext,
	LDIdentifyResult,
	LDWaitForInitializationResult,
} from "@launchdarkly/node-client-sdk";

import type { FeatureFlagContext } from "./types";
import type { KernelLogger as Logger } from "@kilo-desktop/kernel";

const changeListeners = new Set<() => void>();
const offSpy = vi.fn();
const variationSpy = vi.fn((_key: string, defaultValue: unknown) => defaultValue);
const allFlagsSpy = vi.fn<() => Record<string, unknown>>(() => ({}));
const closeSpy = vi.fn(async () => {});
const startSpy = vi.fn<() => Promise<LDWaitForInitializationResult>>(async () => ({
	status: "complete",
}));
const identifySpy = vi.fn<(context: LDContext) => Promise<LDIdentifyResult>>(async () => ({
	status: "completed",
}));

const client = {
	on: (event: string, cb: () => void) => {
		if (event === "change") changeListeners.add(cb);
	},
	off: offSpy,
	start: startSpy,
	identify: identifySpy,
	variation: variationSpy,
	allFlags: allFlagsSpy,
	close: closeSpy,
} as unknown as LDClient;

const createClientSpy = vi.fn(() => client);

vi.mock("@launchdarkly/node-client-sdk", () => ({
	createClient: (...args: unknown[]) => createClientSpy(...(args as [])),
}));

const { LaunchDarklyProvider, redactSdkDebugPayload } = await import("./provider");
type LaunchDarklyProviderOptions = ConstructorParameters<typeof LaunchDarklyProvider>[0];

function fakeLogger(overrides: Partial<Logger> = {}): Logger {
	return { debug() {}, info() {}, warn() {}, error() {}, ...overrides };
}

const employeeContext: FeatureFlagContext = {
	userId: "u1",
	isEmployee: true,
	subscription: "free_subscription",
	email: "dev@anaconda.com",
	username: "ada",
	firstName: "Ada",
	lastName: "Lovelace",
	name: "Ada Lovelace",
};

function makeProvider(extra: Partial<LaunchDarklyProviderOptions> = {}) {
	return new LaunchDarklyProvider({
		clientSideId: "test-id",
		initialContext: { isEmployee: false },
		appVersion: "1.2.3",
		logger: fakeLogger(),
		...extra,
	});
}

beforeEach(() => {
	changeListeners.clear();
	startSpy.mockReset().mockResolvedValue({ status: "complete" });
	identifySpy.mockReset().mockResolvedValue({ status: "completed" });
	variationSpy.mockClear().mockImplementation((_key, defaultValue) => defaultValue);
	allFlagsSpy.mockClear().mockReturnValue({});
	closeSpy.mockClear();
	offSpy.mockClear();
	createClientSpy.mockClear();
});

describe("LaunchDarklyProvider", () => {
	it("passes storagePath to the SDK as localStoragePath", () => {
		makeProvider({ storagePath: "/user-data/launchdarkly" });

		expect(createClientSpy).toHaveBeenCalledWith(
			"test-id",
			expect.anything(),
			expect.objectContaining({ localStoragePath: "/user-data/launchdarkly" }),
		);
	});

	it("start() returns the SDK status and passes a timeout", async () => {
		const provider = makeProvider();

		await expect(provider.start()).resolves.toBe("complete");
		expect(startSpy).toHaveBeenCalledWith({ timeout: 5 });
	});

	it("start() reports timeout without throwing", async () => {
		startSpy.mockResolvedValue({ status: "timeout" });
		const provider = makeProvider();

		await expect(provider.start()).resolves.toBe("timeout");
	});

	it("start() reports failed and logs the error", async () => {
		const error = new Error("bad client id");
		const errorSpy = vi.fn();
		startSpy.mockResolvedValue({ status: "failed", error });
		const provider = makeProvider({ logger: fakeLogger({ error: errorSpy }) });

		await expect(provider.start()).resolves.toBe("failed");
		expect(errorSpy).toHaveBeenCalledWith(expect.any(String), error);
	});

	it("start() maps a thrown start to failed", async () => {
		startSpy.mockRejectedValue(new Error("boom"));
		const provider = makeProvider();

		await expect(provider.start()).resolves.toBe("failed");
	});

	it("start() is a start-once singleton across concurrent and repeated calls", async () => {
		const provider = makeProvider();

		await Promise.all([provider.start(), provider.start()]);
		await provider.start();

		expect(startSpy).toHaveBeenCalledTimes(1);
	});

	it("identify() starts first, then identifies with the derived context", async () => {
		const provider = makeProvider();

		await provider.identify(employeeContext);

		expect(startSpy).toHaveBeenCalledTimes(1);
		const ldContext = identifySpy.mock.calls[0]?.[0];
		expect(ldContext).toMatchObject({
			kind: "user",
			key: "u1",
			anonymous: false,
			name: "Ada Lovelace",
			firstName: "Ada",
			lastName: "Lovelace",
			email: "dev@anaconda.com",
			username: "ada",
			is_anaconda_employee: true,
			subscription: "free_subscription",
			app_version: "1.2.3",
		});
	});

	it("emits a multi-context with an organization when one is present", async () => {
		const provider = makeProvider();

		await provider.identify({
			...employeeContext,
			organization: { id: "org-1", name: "Acme", role: "admin" },
		});

		const ldContext = identifySpy.mock.calls[0]?.[0];
		expect(ldContext).toMatchObject({
			kind: "multi",
			user: {
				key: "u1",
				anonymous: false,
				email: "dev@anaconda.com",
				is_anaconda_employee: true,
			},
			organization: {
				key: "org-1",
				name: "Acme",
				role: "admin",
			},
		});
		// The nested user context should not carry its own `kind` field.
		expect((ldContext as unknown as { user: Record<string, unknown> }).user).not.toHaveProperty(
			"kind",
		);
	});

	it("emits an anonymous single-user context when no userId is set", async () => {
		const provider = makeProvider();

		await provider.identify({ isEmployee: false });

		const ldContext = identifySpy.mock.calls[0]?.[0];
		expect(ldContext).toMatchObject({
			kind: "user",
			key: "anonymous",
			anonymous: true,
			is_anaconda_employee: false,
			app_version: "1.2.3",
		});
		expect(ldContext).not.toHaveProperty("email");
		expect(ldContext).not.toHaveProperty("name");
	});

	it("identify() still applies the context when start timed out", async () => {
		startSpy.mockResolvedValue({ status: "timeout" });
		const provider = makeProvider();

		await provider.identify(employeeContext);

		expect(identifySpy).toHaveBeenCalledTimes(1);
	});

	it("identify() swallows a rejected identify so offline boot never throws", async () => {
		identifySpy.mockRejectedValue(new Error("network"));
		const provider = makeProvider();

		await expect(provider.identify(employeeContext)).resolves.toBeUndefined();
	});

	it("re-emits the SDK change event", async () => {
		const provider = makeProvider();
		const onChange = vi.fn();
		provider.on("change", onChange);

		changeListeners.forEach((cb) => cb());

		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("getFlag delegates to the client variation with the default value", () => {
		variationSpy.mockReturnValueOnce("enabled");
		const provider = makeProvider();

		expect(provider.getFlag("my-flag", "off")).toBe("enabled");
		expect(variationSpy).toHaveBeenCalledWith("my-flag", "off");
	});

	it("getAllFlags delegates to the client allFlags", () => {
		allFlagsSpy.mockReturnValueOnce({ a: true, b: 2 });
		const provider = makeProvider();

		expect(provider.getAllFlags()).toEqual({ a: true, b: 2 });
		expect(allFlagsSpy).toHaveBeenCalledTimes(1);
	});

	it("dispose removes listeners and closes the client", async () => {
		const provider = makeProvider();
		const onChange = vi.fn();
		provider.on("change", onChange);

		await provider.dispose();

		expect(closeSpy).toHaveBeenCalledTimes(1);
		// Listeners were removed, so a subsequent SDK change is not re-emitted.
		changeListeners.forEach((cb) => cb());
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("redactSdkDebugPayload", () => {
	it("redacts PII attribute values from an SDK context dump", () => {
		const payload =
			'Identifying {"kind":"user","key":"u1","name":"Ada Lovelace","firstName":"Ada",' +
			'"lastName":"Lovelace","email":"ada@example.com","username":"ada",' +
			'"is_anaconda_employee":true,"subscription":"free_subscription","app_version":"1.2.3"}';

		const redacted = redactSdkDebugPayload(payload);

		expect(redacted).toContain('"email":"***"');
		expect(redacted).toContain('"name":"***"');
		expect(redacted).toContain('"firstName":"***"');
		expect(redacted).toContain('"lastName":"***"');
		expect(redacted).toContain('"username":"***"');
		expect(redacted).not.toContain("ada@example.com");
		expect(redacted).not.toContain("Ada");
		// Non-PII attributes survive untouched.
		expect(redacted).toContain('"key":"u1"');
		expect(redacted).toContain('"is_anaconda_employee":true');
		expect(redacted).toContain('"subscription":"free_subscription"');
	});

	it("leaves payloads without PII attributes unchanged", () => {
		const payload = 'Received put event {"flags":["a","b"]}';

		expect(redactSdkDebugPayload(payload)).toBe(payload);
	});
});
