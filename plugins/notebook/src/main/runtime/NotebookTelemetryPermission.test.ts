import { describe, expect, it, vi } from "vitest";

import {
	NotebookTelemetryPermission,
	type TelemetryRegistration,
} from "./NotebookTelemetryPermission.js";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function setup(flag: unknown = true) {
	const handle = {
		updatePermission: vi.fn(async (_allowed: boolean): Promise<void> => undefined),
		close: vi.fn(async (): Promise<void> => undefined),
	};
	const openRegistration = vi.fn(async (): Promise<TelemetryRegistration | null> => handle);
	const readFeatureFlag = vi.fn((): unknown => flag);
	const controller = new NotebookTelemetryPermission({
		socketPath: "/tmp/notebook.sock",
		openRegistration,
		readFeatureFlag,
	});
	return { controller, handle, openRegistration, readFeatureFlag };
}

describe("NotebookTelemetryPermission", () => {
	it.each([false, undefined, null, "true", 1])("denies non-true flag %s", async (flag) => {
		const { controller, openRegistration, readFeatureFlag } = setup();
		readFeatureFlag.mockReturnValue(flag);
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		expect(openRegistration).not.toHaveBeenCalled();
		await controller.dispose();
	});

	it("denies missing consent and aggregates notebook IDs under one owner", async () => {
		const { controller, handle, openRegistration } = setup();
		await controller.refreshFeatureFlag();
		await controller.setNotebookActive("one", true);
		expect(openRegistration).not.toHaveBeenCalled();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		await controller.setNotebookActive("two", true);
		await controller.setNotebookActive("one", false);
		expect(openRegistration).toHaveBeenCalledOnce();
		expect(handle.close).not.toHaveBeenCalled();
		await controller.setNotebookActive("two", false);
		expect(handle.close).toHaveBeenCalledOnce();
	});

	it("requires a strict enabled gate, consent, and an active notebook", async () => {
		const { controller, handle, openRegistration } = setup();
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		expect(openRegistration).not.toHaveBeenCalled();
		await controller.setNotebookActive("one", true);
		expect(openRegistration).toHaveBeenCalledExactlyOnceWith({
			socketPath: "/tmp/notebook.sock",
			hostId: "kilo-desktop",
			source: "app",
			allowed: false,
		});
		expect(handle.updatePermission).toHaveBeenCalledWith(true);
		await controller.dispose();
		expect(handle.close).toHaveBeenCalledOnce();
	});

	it.each(["withdrawal", "dispose", "last notebook"])(
		"closes a late denied open without granting after %s and awaits close acknowledgement",
		async (reason) => {
			const { controller, handle, openRegistration } = setup();
			const opening = deferred<TelemetryRegistration>();
			const closing = deferred<void>();
			openRegistration.mockReturnValueOnce(opening.promise);
			handle.close.mockReturnValueOnce(closing.promise);
			await controller.refreshFeatureFlag();
			await controller.setAllowed(true);
			const active = controller.setNotebookActive("one", true);
			await vi.waitFor(() => expect(openRegistration).toHaveBeenCalledOnce());
			const withdraw =
				reason === "withdrawal"
					? controller.setAllowed(false)
					: reason === "dispose"
						? controller.dispose()
						: controller.setNotebookActive("one", false);
			const settled = vi.fn();
			void withdraw.then(settled);
			opening.resolve(handle);
			await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
			expect(handle.updatePermission).not.toHaveBeenCalled();
			expect(settled).not.toHaveBeenCalled();
			closing.resolve();
			await Promise.all([active, withdraw]);
			if (reason === "dispose") {
				await controller.setAllowed(true);
				await controller.setNotebookActive("two", true);
				await controller.refreshFeatureFlag();
				expect(openRegistration).toHaveBeenCalledOnce();
			}
		},
	);

	it("fences an in-flight grant even when permission is restored before its acknowledgement", async () => {
		const { controller, handle, openRegistration } = setup();
		const granting = deferred<void>();
		const closing = deferred<void>();
		handle.updatePermission.mockReturnValueOnce(granting.promise);
		handle.close.mockReturnValueOnce(closing.promise);
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		const active = controller.setNotebookActive("one", true);
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledOnce());
		const denied = controller.setAllowed(false);
		const restored = controller.setAllowed(true);
		granting.resolve();
		await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
		expect(openRegistration).toHaveBeenCalledOnce();
		closing.resolve();
		await Promise.all([active, denied, restored]);
		expect(openRegistration).toHaveBeenCalledTimes(2);
		await controller.dispose();
	});

	it("ignores stale async flag reads and prevents grants while the current flag is pending", async () => {
		const { controller, openRegistration, readFeatureFlag } = setup();
		const oldFlag = deferred<boolean>();
		const currentFlag = deferred<boolean>();
		readFeatureFlag.mockReturnValueOnce(oldFlag.promise).mockReturnValueOnce(currentFlag.promise);
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		const oldRefresh = controller.refreshFeatureFlag();
		const currentRefresh = controller.refreshFeatureFlag();
		oldFlag.resolve(true);
		await oldRefresh;
		expect(openRegistration).not.toHaveBeenCalled();
		currentFlag.resolve(false);
		await currentRefresh;
		expect(openRegistration).not.toHaveBeenCalled();
	});

	it("revokes immediately during flag evaluation and stays denied after evaluation fails", async () => {
		const { controller, handle, openRegistration, readFeatureFlag } = setup();
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		const flag = deferred<boolean>();
		readFeatureFlag.mockReturnValueOnce(flag.promise);
		const refresh = controller.refreshFeatureFlag();
		await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
		const failure = expect(refresh).rejects.toThrow("flag unavailable");
		flag.reject(new Error("flag unavailable"));
		await failure;
		await controller.setNotebookActive("two", true);
		expect(openRegistration).toHaveBeenCalledOnce();
	});

	it("supports older daemons and retries failed opens only on explicit active reconciliation", async () => {
		const { controller, openRegistration } = setup();
		openRegistration.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("unavailable"));
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		expect(openRegistration).toHaveBeenCalledOnce();
		await expect(controller.setNotebookActive("two", true)).rejects.toThrow("unavailable");
		expect(openRegistration).toHaveBeenCalledTimes(2);
		await controller.setNotebookActive("two", true);
		expect(openRegistration).toHaveBeenCalledTimes(3);
		await controller.dispose();
	});

	it("awaits revocation even when an asynchronous flag read fails first", async () => {
		const { controller, handle, readFeatureFlag } = setup();
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		const closing = deferred<void>();
		handle.close.mockReturnValueOnce(closing.promise);
		readFeatureFlag.mockImplementationOnce(() => {
			throw new Error("flag unavailable");
		});
		const settled = vi.fn();
		const refresh = controller.refreshFeatureFlag().catch(settled);
		await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
		expect(settled).not.toHaveBeenCalled();
		closing.resolve();
		await refresh;
		expect(settled).toHaveBeenCalledWith(expect.objectContaining({ message: "flag unavailable" }));
	});

	it("reports a failed grant, closes it, and requires explicit reconciliation to recover", async () => {
		const { controller, handle, openRegistration } = setup();
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		handle.updatePermission.mockRejectedValueOnce(new Error("closed daemon handle"));
		await expect(controller.setNotebookActive("two", true)).rejects.toThrow("closed daemon handle");
		expect(handle.close).toHaveBeenCalledOnce();
		expect(openRegistration).toHaveBeenCalledOnce();
		await controller.setAllowed(false);
		await controller.setNotebookActive("three", true);
		expect(openRegistration).toHaveBeenCalledOnce();
		await controller.setAllowed(true);
		expect(openRegistration).toHaveBeenCalledTimes(2);
		await controller.dispose();
	});

	it("discards a terminal handle but does not retry from queued activity after the failure", async () => {
		const { controller, handle, openRegistration } = setup();
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		await controller.setNotebookActive("one", true);
		const updating = deferred<void>();
		handle.updatePermission.mockReturnValueOnce(updating.promise);
		handle.close.mockRejectedValue(new Error("terminal connection, no revoke acknowledgement"));
		const update = controller.setNotebookActive("two", true);
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledTimes(2));
		const queued = expect(controller.setNotebookActive("three", true)).rejects.toThrow(
			"no revoke acknowledgement",
		);
		const failed = expect(update).rejects.toThrow("no revoke acknowledgement");
		updating.reject(new Error("terminal"));
		await failed;
		await queued;
		expect(openRegistration).toHaveBeenCalledOnce();
		const replacement = {
			updatePermission: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
		};
		openRegistration.mockResolvedValueOnce(replacement);
		await controller.setNotebookActive("four", true);
		expect(openRegistration).toHaveBeenCalledTimes(2);
		expect(replacement.updatePermission).toHaveBeenCalledWith(true);
		await controller.dispose();
	});

	it("rejects queued withdrawal when closing a late grant fails", async () => {
		const { controller, handle } = setup();
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		const granting = deferred<void>();
		handle.updatePermission.mockReturnValueOnce(granting.promise);
		handle.close.mockRejectedValueOnce(new Error("no revoke acknowledgement"));
		const active = controller.setNotebookActive("one", true);
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledOnce());
		const withdrawal = expect(controller.setAllowed(false)).rejects.toThrow(
			"no revoke acknowledgement",
		);
		const failed = expect(active).rejects.toThrow("no revoke acknowledgement");
		granting.resolve();
		await Promise.all([failed, withdrawal]);
	});

	it("starts close immediately to fence a queued native grant, then awaits its acknowledgement", async () => {
		const { controller, handle } = setup();
		const granting = deferred<void>();
		const closing = deferred<void>();
		handle.updatePermission.mockReturnValueOnce(granting.promise);
		handle.close.mockReturnValueOnce(closing.promise);
		await controller.refreshFeatureFlag();
		await controller.setAllowed(true);
		const active = controller.setNotebookActive("one", true);
		await vi.waitFor(() => expect(handle.updatePermission).toHaveBeenCalledOnce());
		const settled = vi.fn();
		const withdrawal = controller.setAllowed(false).then(settled);
		expect(handle.close).toHaveBeenCalledOnce();
		granting.reject(new Error("grant fenced by close"));
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();
		closing.resolve();
		await Promise.all([active, withdrawal]);
		expect(handle.close).toHaveBeenCalledOnce();
	});
});
