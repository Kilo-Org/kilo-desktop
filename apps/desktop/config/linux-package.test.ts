import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	LINUX_PACKAGE_FORMAT_FILE,
	getRpmVersion,
	readLinuxPackageFormat,
} from "./linux-package.js";

describe("getRpmVersion", () => {
	it("keeps a release version unchanged", () => {
		expect(getRpmVersion("0.1.17")).toBe("0.1.17");
	});

	it("sorts a preview build before the release it leads up to", () => {
		// RPM forbids "-" in Version; "~" sorts before the bare version, so a
		// Stable 0.1.17 upgrades an installed 0.1.17 Preview like semver does.
		expect(getRpmVersion("0.1.17-preview-261118-10380")).toBe("0.1.17~preview.261118.10380");
	});

	it("turns a Stable prerelease into an RPM pre-release", () => {
		expect(getRpmVersion("0.2.0-rc.1")).toBe("0.2.0~rc.1");
	});

	it("rejects a version that is not semver", () => {
		expect(() => getRpmVersion("latest")).toThrow("Invalid app version: latest");
	});
});

describe("readLinuxPackageFormat", () => {
	async function resources(contents?: string): Promise<string> {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-linux-package-"));
		if (contents !== undefined) {
			await writeFile(path.join(directory, LINUX_PACKAGE_FORMAT_FILE), contents);
		}
		return directory;
	}

	it("reports an RPM install from the marker the RPM package ships", async () => {
		expect(readLinuxPackageFormat(await resources("rpm\n"))).toBe("rpm");
	});

	it("treats an install without the marker as a DEB install", async () => {
		expect(readLinuxPackageFormat(await resources())).toBe("deb");
	});

	it("ignores a marker naming an unknown format", async () => {
		expect(readLinuxPackageFormat(await resources("snap"))).toBe("deb");
	});
});
