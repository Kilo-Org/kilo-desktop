import { afterEach, describe, expect, it, vi } from "vitest";

import { NewNotebookTrust, type TrustSession } from "./NewNotebookTrust";

const NOTEBOOK_ID = "2c7f2b1e-7e0a-4c1f-9d57-6a8b2f0c9e11";

function fakeSession(
	options: {
		dependencies?: string[];
		untrusted?: boolean;
		lifecycle?: string;
		approve?: () => Promise<void>;
	} = {},
) {
	let emit: () => void = () => undefined;
	const session = {
		runtimeState$: {
			subscribe: vi.fn((observer: { next: () => void }) => {
				emit = observer.next;
				return { unsubscribe: vi.fn() };
			}),
		},
		getDependencyStatus: vi.fn(async () => ({
			conda: { dependencies: options.dependencies ?? ["humanize"], channels: ["conda-forge"] },
			fingerprint: "deps-1",
			trust: { status: options.untrusted === false ? "trusted" : "untrusted" },
		})),
		getRuntimeStatus: vi.fn(async () => ({ lifecycle: options.lifecycle ?? "AwaitingTrust" })),
		approveTrust: vi.fn(options.approve ?? (async () => undefined)),
		restartKernel: vi.fn(async () => undefined),
		syncEnvironment: vi.fn(async () => undefined),
		close: vi.fn(async () => undefined),
	};
	return { session, emit: () => emit() };
}

function trustFor(session: ReturnType<typeof fakeSession>["session"], enabled = { value: true }) {
	const openNotebook = vi.fn(async () => session as unknown as TrustSession);
	const logger = { warn: vi.fn() };
	const trust = new NewNotebookTrust({
		openNotebook,
		isEnabled: () => enabled.value,
		logger,
		settleMs: 0,
	});
	return { trust, openNotebook, logger, enabled };
}

afterEach(() => vi.useRealTimers());

describe("NewNotebookTrust", () => {
	it("approves a new notebook's dependencies and starts the kernel waiting on trust", async () => {
		const { session } = fakeSession();
		const { trust, openNotebook } = trustFor(session);

		trust.track(NOTEBOOK_ID);

		await vi.waitFor(() => expect(session.restartKernel).toHaveBeenCalledOnce());
		expect(openNotebook).toHaveBeenCalledWith(NOTEBOOK_ID);
		expect(session.approveTrust).toHaveBeenCalledOnce();
	});

	it("installs newly approved packages into a running kernel", async () => {
		const { session } = fakeSession({ lifecycle: "Running" });
		const { trust } = trustFor(session);

		trust.track(NOTEBOOK_ID);

		await vi.waitFor(() => expect(session.syncEnvironment).toHaveBeenCalledOnce());
		expect(session.restartKernel).not.toHaveBeenCalled();
	});

	it("leaves nteract's prompt in place for suspected typosquats", async () => {
		const { session } = fakeSession({ dependencies: ["numppy"] });
		const { trust } = trustFor(session);

		trust.track(NOTEBOOK_ID);

		await vi.waitFor(() => expect(session.getDependencyStatus).toHaveBeenCalled());
		expect(session.approveTrust).not.toHaveBeenCalled();
	});

	it("does nothing for a trusted notebook", async () => {
		const { session } = fakeSession({ untrusted: false });
		const { trust } = trustFor(session);

		trust.track(NOTEBOOK_ID);

		await vi.waitFor(() => expect(session.getDependencyStatus).toHaveBeenCalled());
		expect(session.approveTrust).not.toHaveBeenCalled();
	});

	it("re-evaluates on runtime state changes but does not retry a failed approval", async () => {
		const { session, emit } = fakeSession({
			approve: async () => {
				throw new Error("Could not record trusted packages");
			},
		});
		const { trust, logger } = trustFor(session);

		trust.track(NOTEBOOK_ID);
		await vi.waitFor(() => expect(session.approveTrust).toHaveBeenCalledOnce());
		emit();
		await vi.waitFor(() => expect(session.getDependencyStatus).toHaveBeenCalledTimes(2));

		expect(session.approveTrust).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("approval failed"));
	});

	it("opens no peer while disabled and closes peers when turned off or untracked", async () => {
		const { session } = fakeSession({ untrusted: false });
		const { trust, openNotebook, enabled } = trustFor(session, { value: false });

		trust.track(NOTEBOOK_ID);
		expect(openNotebook).not.toHaveBeenCalled();

		enabled.value = true;
		trust.refresh();
		await vi.waitFor(() => expect(openNotebook).toHaveBeenCalledOnce());

		enabled.value = false;
		trust.refresh();
		await vi.waitFor(() => expect(session.close).toHaveBeenCalledOnce());

		enabled.value = true;
		trust.refresh();
		await vi.waitFor(() => expect(openNotebook).toHaveBeenCalledTimes(2));
		trust.untrack(NOTEBOOK_ID);
		await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(2));
	});
});
