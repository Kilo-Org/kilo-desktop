import { afterEach, describe, expect, it, vi } from "vitest";

import { createGitLogger } from "./logger.js";

describe("createGitLogger", () => {
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

	afterEach(() => {
		errorSpy.mockClear();
	});

	it("forwards errors to console.error so the default logger is not silent", () => {
		createGitLogger().error("boom");
		expect(errorSpy).toHaveBeenCalledWith("boom");
	});
});
