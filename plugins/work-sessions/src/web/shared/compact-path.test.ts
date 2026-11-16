import { describe, expect, it } from "vitest";

import { compactPath } from "./compact-path";

describe("compactPath", () => {
	it("shows the home folder as ~", () => {
		expect(compactPath("/Users/yacu/Development/kilo-desktop")).toBe("~/Development/kilo-desktop");
		expect(compactPath("/home/yacu/code/api")).toBe("~/code/api");
		expect(compactPath("C:\\Users\\yacu\\code\\api")).toBe("~\\code\\api");
	});

	it("keeps the first folder and the last two of a deep path", () => {
		expect(compactPath("/var/folders/3j/0jph6/T/kilo/dropdown-fixtures/api")).toBe(
			"/var/…/dropdown-fixtures/api",
		);
		expect(compactPath("/Users/yacu/Development/clients/acme/web")).toBe("~/…/acme/web");
	});

	it("leaves short paths alone", () => {
		expect(compactPath("/projects/app")).toBe("/projects/app");
		expect(compactPath("/Users/yacu")).toBe("~");
	});
});
