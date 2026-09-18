import { describe, expect, it } from "vitest";

import { toForgeArgs } from "./run-packaging.js";

describe("toForgeArgs", () => {
	it("drops pnpm's extra -- so Forge still sees --dry-run as a flag", () => {
		expect(toForgeArgs(["--", "--dry-run"])).toEqual(["--dry-run"]);
	});

	it("leaves Forge flags unchanged when pnpm did not insert --", () => {
		expect(toForgeArgs(["--from-dry-run"])).toEqual(["--from-dry-run"]);
		expect(toForgeArgs(["--dry-run"])).toEqual(["--dry-run"]);
	});
});
