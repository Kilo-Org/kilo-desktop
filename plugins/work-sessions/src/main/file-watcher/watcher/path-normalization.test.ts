import { describe, expect, it } from "vitest";

import { normalizeNFC, normalizeWindowsRootPath, remapRealPath } from "./path-normalization";

describe("normalizeNFC", () => {
	it("composes NFD-decomposed paths to NFC", () => {
		// "café.txt" decomposed (e + combining acute) as FSEvents may report it.
		expect(normalizeNFC("cafe\u0301.txt")).toBe("caf\u00e9.txt");
	});

	it("is the identity for already-composed text", () => {
		expect(normalizeNFC("caf\u00e9.txt")).toBe("caf\u00e9.txt");
	});

	it("is the identity for plain ASCII paths", () => {
		expect(normalizeNFC("/home/user/project/src/a.py")).toBe("/home/user/project/src/a.py");
	});
});

describe("remapRealPath", () => {
	it("remaps an event path from the realpath prefix to the requested prefix", () => {
		expect(remapRealPath("/real/root/src/a.py", "/real/root", "/link/root")).toBe(
			"/link/root/src/a.py",
		);
	});

	it("remaps the watched directory itself", () => {
		expect(remapRealPath("/real/root", "/real/root", "/link/root")).toBe("/link/root");
	});

	it("leaves paths outside the realpath prefix untouched", () => {
		expect(remapRealPath("/elsewhere/a.py", "/real/root", "/link/root")).toBe("/elsewhere/a.py");
	});

	it("is the identity when the realpath equals the requested path", () => {
		expect(remapRealPath("/real/root/a.py", "/real/root", "/real/root")).toBe("/real/root/a.py");
	});

	it("remaps windows separator paths", () => {
		expect(remapRealPath("C:\\real\\root\\src\\a.py", "C:\\real\\root", "C:\\link\\root")).toBe(
			"C:\\link\\root\\src\\a.py",
		);
	});
});

describe("normalizeWindowsRootPath", () => {
	it("collapses duplicated backslashes on drive roots", () => {
		expect(normalizeWindowsRootPath("c:\\\\")).toBe("c:\\");
		expect(normalizeWindowsRootPath("C:\\\\")).toBe("C:\\");
	});

	it("keeps a single-root backslash as-is", () => {
		expect(normalizeWindowsRootPath("c:\\")).toBe("c:\\");
	});

	it("leaves ordinary windows paths untouched", () => {
		expect(normalizeWindowsRootPath("C:\\normal\\path")).toBe("C:\\normal\\path");
	});

	it("leaves posix paths untouched", () => {
		expect(normalizeWindowsRootPath("/home/user")).toBe("/home/user");
	});
});
