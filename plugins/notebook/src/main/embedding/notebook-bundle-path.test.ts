import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveNotebookBundleRoot } from "./notebook-bundle-path.js";

describe("resolveNotebookBundleRoot", () => {
	it("accepts a plugin-resolved directory containing index.html", () => {
		const candidate = "/repo/plugins/notebook/build/notebook";
		expect(resolveNotebookBundleRoot({ candidate, exists: () => true })).toBe(candidate);
	});

	it("is undefined when this build bundles no notebook UI", () => {
		expect(
			resolveNotebookBundleRoot({ candidate: "/missing/notebook", exists: () => false }),
		).toBeUndefined();
	});

	it("falls back to the filesystem when no exists probe is supplied", () => {
		expect(
			resolveNotebookBundleRoot({ candidate: "/missing/notebook-bundle-that-does-not-exist" }),
		).toBeUndefined();
	});

	it("probes index.html rather than accepting an empty directory", () => {
		const candidate = "/repo/plugins/notebook/build/notebook";
		const probed: string[] = [];
		resolveNotebookBundleRoot({
			candidate,
			exists: (pathToProbe) => {
				probed.push(pathToProbe);
				return false;
			},
		});
		expect(probed).toEqual([path.join(candidate, "index.html")]);
	});
});
