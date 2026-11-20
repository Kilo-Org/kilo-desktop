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

import { adoptEarlierCache } from "./cache-adoption";

const directories: string[] = [];
afterEach(() => {
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function layout() {
	const root = mkdtempSync(path.join(os.tmpdir(), "flags-cache-"));
	directories.push(root);
	return {
		origin: path.join(root, "launchdarkly"),
		flags: path.join(root, "plugins", "kilo.flags", "launchdarkly"),
		own: path.join(root, "plugins", "kilo.core", "launchdarkly"),
	};
}

describe("adoptEarlierCache", () => {
	it("copies origin's LaunchDarkly cache when kilo.core has none, leaving origin's", () => {
		const { origin, own } = layout();
		mkdirSync(origin);
		writeFileSync(path.join(origin, "flags.json"), "cached");

		adoptEarlierCache([origin], own);

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

		adoptEarlierCache([origin], own);

		expect(readFileSync(path.join(own, "flags.json"), "utf8")).toBe("mine");
	});

	it("does nothing without origin's cache", () => {
		const { origin, own } = layout();

		adoptEarlierCache([origin], own);

		expect(existsSync(own)).toBe(false);
	});

	it("prefers kilo.flags' cache over origin's", () => {
		const { origin, flags, own } = layout();
		mkdirSync(origin);
		writeFileSync(path.join(origin, "flags.json"), "origin");
		mkdirSync(flags, { recursive: true });
		writeFileSync(path.join(flags, "flags.json"), "kilo.flags");

		adoptEarlierCache([flags, origin], own);

		expect(readFileSync(path.join(own, "flags.json"), "utf8")).toBe("kilo.flags");
		expect(readFileSync(path.join(flags, "flags.json"), "utf8")).toBe("kilo.flags");
	});

	it("falls back to origin's cache when kilo.flags has none", () => {
		const { origin, flags, own } = layout();
		mkdirSync(origin);
		writeFileSync(path.join(origin, "flags.json"), "origin");

		adoptEarlierCache([flags, origin], own);

		expect(readFileSync(path.join(own, "flags.json"), "utf8")).toBe("origin");
	});
});
