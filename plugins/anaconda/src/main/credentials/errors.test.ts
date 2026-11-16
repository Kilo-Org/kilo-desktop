import { describe, expect, it, vi } from "vitest";

import { AnacondaKeyringWriteError, SystemKeyringError } from "./errors";

describe("credential errors", () => {
	it("preserves filesystem error codes for keyring write failures", () => {
		const cause = Object.assign(new Error("denied"), { code: "EACCES" });

		expect(new AnacondaKeyringWriteError("/tmp/keyring", cause).errnoCode).toBe("EACCES");
	});

	it("leaves errnoCode undefined when a write error has no code", () => {
		expect(
			new AnacondaKeyringWriteError("/tmp/keyring", new Error("denied")).errnoCode,
		).toBeUndefined();
	});

	it("adds Linux keyring troubleshooting context", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("linux");

		expect(new SystemKeyringError(new Error("unavailable")).message).toMatch(/libsecret/);
	});
});
