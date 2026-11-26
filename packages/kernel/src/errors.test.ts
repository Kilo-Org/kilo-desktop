import { describe, expect, it } from "vitest";

import { KernelError, serializeError } from "./errors";

describe("KernelError detail", () => {
	const error = new KernelError("BUSINESS", "Server exited before becoming ready (code 1).", {
		detail: "Configuration is invalid\n↳ Unrecognized key: reasoning_display",
	});

	it("is readable locally", () => {
		expect(error.detail).toBe("Configuration is invalid\n↳ Unrecognized key: reasoning_display");
	});

	it("is left out of enumeration, JSON and the serialized error", () => {
		expect(Object.keys(error)).not.toContain("detail");
		expect(JSON.stringify(error)).not.toContain("reasoning_display");
		expect(serializeError(error)).toEqual({
			code: "BUSINESS",
			message: "Server exited before becoming ready (code 1).",
		});
	});
});
