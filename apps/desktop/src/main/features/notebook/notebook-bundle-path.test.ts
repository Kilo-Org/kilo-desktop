import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveNotebookBundleRoot } from "./notebook-bundle-path.js";

const PACKAGED = {
	isPackaged: true,
	resourcesPath: "/Apps/Agentic.app/Contents/Resources",
	appPath: "/Apps/Agentic.app/Contents/Resources/app.asar",
};
const UNPACKAGED = {
	isPackaged: false,
	resourcesPath: "/repo/node_modules/electron/dist/Resources",
	appPath: "/repo/apps/desktop",
};

describe("resolveNotebookBundleRoot", () => {
	it("reads the bundle out of resourcesPath in a packaged app", () => {
		// extraResource on a directory lands it as Contents/Resources/notebook/.
		expect(resolveNotebookBundleRoot({ ...PACKAGED, exists: () => true })).toBe(
			path.join(PACKAGED.resourcesPath, "notebook"),
		);
	});

	it("reads the staged bundle from the package root when unpackaged", () => {
		expect(resolveNotebookBundleRoot({ ...UNPACKAGED, exists: () => true })).toBe(
			"/repo/apps/desktop/build/notebook",
		);
	});

	it("is undefined when this build bundles no notebook UI", () => {
		// Not an error, same contract as a missing daemon: the host is still
		// contributed and its requests serve 404.
		expect(resolveNotebookBundleRoot({ ...PACKAGED, exists: () => false })).toBeUndefined();
	});

	it("probes index.html, so an empty staging directory does not count as a bundle", () => {
		const probed: string[] = [];
		resolveNotebookBundleRoot({
			...PACKAGED,
			exists: (candidate) => {
				probed.push(candidate);
				return false;
			},
		});
		expect(probed).toEqual([path.join(PACKAGED.resourcesPath, "notebook", "index.html")]);
	});
});
