import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { adoptOriginCache } from "./origin-cache";

const directories: string[] = [];
afterEach(() => {
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function layout() {
	const root = mkdtempSync(path.join(os.tmpdir(), "flags-cache-"));
	directories.push(root);
	return {
		origin: path.join(root, "launchdarkly"),
		own: path.join(root, "kilo.flags", "launchdarkly"),
	};
}

describe("adoptOriginCache", () => {
	it("copies origin's LaunchDarkly cache when this app has none, leaving origin's", () => {
		const { origin, own } = layout();
		mkdirSync(origin);
		writeFileSync(path.join(origin, "flags.json"), "cached");

		adoptOriginCache(origin, own);

		expect(readFileSync(path.join(own, "flags.json"), "utf8")).toBe("cached");
		expect(readFileSync(path.join(origin, "flags.json"), "utf8")).toBe("cached");
		expect(readdirSync(path.dirname(own))).toEqual(["launchdarkly"]);
	});

	it("keeps a cache this app already has", () => {
		const { origin, own } = layout();
		mkdirSync(origin);
		writeFileSync(path.join(origin, "flags.json"), "theirs");
		mkdirSync(own, { recursive: true });
		writeFileSync(path.join(own, "flags.json"), "mine");

		adoptOriginCache(origin, own);

		expect(readFileSync(path.join(own, "flags.json"), "utf8")).toBe("mine");
	});

	it("does nothing without origin's cache", () => {
		const { origin, own } = layout();

		adoptOriginCache(origin, own);

		expect(existsSync(own)).toBe(false);
	});
});
