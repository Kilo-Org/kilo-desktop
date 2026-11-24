import { describe, expect, it, vi } from "vitest";

import { DisposableScope } from "./disposables";
import { INTERNAL_ERROR_MESSAGE, isKernelError, KernelError, serializeError } from "./errors";
import { isQualifiedId, parseQualifiedId } from "./ids";
import { ContextKeyStore } from "./when";

describe("KernelError", () => {
	/** What another copy of the kernel (bundled into an external plugin) throws. */
	function foreignKernelError(code: string, message: string): Error {
		const error = Object.assign(new Error(message), { name: "KernelError", code });
		Object.defineProperty(error, Symbol.for("kilo-desktop.kernel-error"), { value: true });
		return error;
	}

	it("is recognised when thrown by another copy of the kernel", () => {
		const foreign = foreignKernelError("NOT_FOUND", "No such greeting.");

		expect(foreign instanceof KernelError).toBe(true);
		expect(isKernelError(foreign, "NOT_FOUND")).toBe(true);
		expect(serializeError(foreign)).toEqual({ code: "NOT_FOUND", message: "No such greeting." });
	});

	it("still scrubs ordinary errors", () => {
		expect(new KernelError("VALIDATION", "Bad input.") instanceof KernelError).toBe(true);
		expect(new Error("secret path") instanceof KernelError).toBe(false);
		expect(serializeError(new Error("secret path"))).toEqual({
			code: "INTERNAL",
			message: INTERNAL_ERROR_MESSAGE,
		});
	});
});

describe("DisposableScope", () => {
	it("runs disposers once, in reverse order, and keeps going when one fails", async () => {
		const order: string[] = [];
		const errors: unknown[] = [];
		const scope = new DisposableScope();
		scope.add(() => void order.push("first"));
		scope.add(() => {
			throw new Error("broken");
		});
		const removeEarly = scope.add(() => void order.push("early"));
		removeEarly();
		removeEarly();

		await scope.dispose((error) => void errors.push(error));
		await scope.dispose();

		expect(order).toEqual(["early", "first"]);
		expect(errors).toHaveLength(1);
		expect(scope.disposed).toBe(true);
	});

	it("runs a disposer immediately when added after disposal", async () => {
		const scope = new DisposableScope();
		await scope.dispose();
		const disposer = vi.fn();

		scope.add(disposer);

		expect(disposer).toHaveBeenCalledOnce();
	});
});

describe("qualified ids", () => {
	it("accept owner/local and reject malformed ids", () => {
		expect(parseQualifiedId("acme.app/thing")).toEqual({ owner: "acme.app", local: "thing" });
		expect(isQualifiedId("kernel/root")).toBe(true);
		expect(isQualifiedId("Acme/thing")).toBe(false);
		expect(isQualifiedId("acme.app/a/b")).toBe(false);
		expect(isQualifiedId("acme.app/")).toBe(false);
	});
});

describe("ContextKeyStore", () => {
	it("mirrors one scope without touching keys of the other", () => {
		const store = new ContextKeyStore();
		store.declare({ id: "acme.app/global", scope: "global" });
		store.declare({ id: "acme.app/focus", scope: "window" });
		store.set("acme.app", "acme.app/focus", true);
		store.replaceScope("global", { "acme.app/global": true });

		store.replaceScope("global", {});

		expect(store.snapshot()).toEqual({ "acme.app/focus": true });
	});

	it("matches prefix-declared keys and refuses keys owned by someone else", () => {
		const store = new ContextKeyStore();
		store.declare({ id: "acme.flags/flag:*", scope: "global" });

		store.set("acme.flags", "acme.flags/flag:beta", true);

		expect(store.evaluate({ all: ["acme.flags/flag:beta"], none: ["acme.flags/flag:old"] })).toBe(
			true,
		);
		expect(() => store.set("acme.other", "acme.flags/flag:beta", false)).toThrow(/owned by/);
	});
});
