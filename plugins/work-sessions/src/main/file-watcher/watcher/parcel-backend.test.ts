import { describe, expect, it } from "vitest";

import { parcelBackend } from "./parcel-backend";

describe("parcelBackend", () => {
	it.each([
		["win32", "windows"],
		["linux", "inotify"],
		["darwin", "fs-events"],
		["freebsd", undefined],
	] as const)("pins %s to %s", (platform, backend) => {
		expect(parcelBackend(platform)).toBe(backend);
	});
});
