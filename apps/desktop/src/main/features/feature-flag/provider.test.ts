import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	LDClient,
	LDContext,
	LDIdentifyResult,
	LDWaitForInitializationResult,
} from "@launchdarkly/node-client-sdk";

import type { FeatureFlagContext } from "./types.js";
import type { Logger } from "../../platform/logger.js";

const changeListeners = new Set<() => void>();
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
	off: () => {},
	start: startSpy,
	identify: identifySpy,
	variation: (_key: string, defaultValue: unknown) => defaultValue,
	allFlags: () => ({}),
	close: async () => {},
} as unknown as LDClient;

const createClientSpy = vi.fn(() => client);

vi.mock("@launchdarkly/node-client-sdk", () => ({
	createClient: (...args: unknown[]) => createClientSpy(...(args as [])),
}));

const { LaunchDarklyProvider } = await import("./provider.js");
type LaunchDarklyProviderOptions = ConstructorParameters<typeof LaunchDarklyProvider>[0];

function fakeLogger(overrides: Partial<Logger> = {}): Logger {
	return { info() {}, warn() {}, error() {}, ...overrides } as unknown as Logger;
}

const employeeContext: FeatureFlagContext = {
	userId: "u1",
	isEmployee: true,
	subscription: "free_subscription",
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
	createClientSpy.mockClear();
});

describe("LaunchDarklyProvider", () => {
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
			is_anaconda_employee: true,
			subscription: "free_subscription",
			app_version: "1.2.3",
		});
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
});
