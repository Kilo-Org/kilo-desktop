import { describe, expect, it } from "vitest";

import { deviceUserCode } from "./account-service";

describe("deviceUserCode", () => {
	it("prefers the verification URL's code over the instructions", () => {
		expect(
			deviceUserCode({
				url: "https://app.kilo.ai/device-auth?code=WXYZ-1234",
				instructions:
					"Open https://app.kilo.ai/device-auth and enter code: 04jF-r2ARIPUwnvoNxQJ8oY1",
			}),
		).toBe("WXYZ-1234");
	});

	it("falls back to the instructions when the URL carries no code", () => {
		expect(
			deviceUserCode({
				url: "https://app.kilo.ai/device",
				instructions: "Enter code: ABCD-1234",
			}),
		).toBe("ABCD-1234");
	});

	it("falls back to the instructions when the URL is not a URL", () => {
		expect(deviceUserCode({ url: "not a url", instructions: "Enter code: ABCD-1234" })).toBe(
			"ABCD-1234",
		);
	});

	it("is undefined when neither the URL nor the instructions carry a code", () => {
		expect(deviceUserCode({ url: "https://app.kilo.ai/device" })).toBeUndefined();
		expect(deviceUserCode({ url: "https://app.kilo.ai/device", instructions: undefined })).toBe(
			undefined,
		);
	});
});
