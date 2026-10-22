import { describe, expect, it } from "vitest";

import {
	browserLocalFilePath,
	browserLocalFileUrl,
	isBrowserLocalFileUrl,
} from "./browser-local-file.js";

describe("browser local file URLs", () => {
	it("round-trips a path with spaces and URL syntax in its names", () => {
		const path = "/Users/me/My Project/Q3 #1 ?final%.html";
		const url = browserLocalFileUrl(path);

		expect(url).toBe("kilo-file://local/Users/me/My%20Project/Q3%20%231%20%3Ffinal%25.html");
		expect(isBrowserLocalFileUrl(url)).toBe(true);
		expect(browserLocalFilePath(url, false)).toBe(path);
	});

	it("round-trips Windows drive paths", () => {
		const url = browserLocalFileUrl("C:\\Users\\me\\Chart.html");

		expect(url).toBe("kilo-file://local/C%3A/Users/me/Chart.html");
		expect(browserLocalFilePath(url, true)).toBe("C:/Users/me/Chart.html");
	});

	it("names no path for other URLs or malformed ones", () => {
		expect(browserLocalFilePath("https://local/etc/hosts", false)).toBeUndefined();
		expect(browserLocalFilePath("kilo-file://elsewhere/etc/hosts", false)).toBeUndefined();
		expect(browserLocalFilePath("kilo-file://local/%E0%A4%A", false)).toBeUndefined();
		expect(browserLocalFilePath("kilo-file://local/a%00b", false)).toBeUndefined();
	});
});
