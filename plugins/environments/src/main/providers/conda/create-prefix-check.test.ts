import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkCreatePrefix } from "./create-prefix-check.js";

const dirs: string[] = [];

afterEach(() => {
	const created = dirs.splice(0);
	// Restore permissions on every scratch dir before removing any of them,
	// so a locked nested dir can't block the recursive delete of its parent.
	for (const dir of created) chmodSync(dir, 0o700);
	for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "create-prefix-"));
	dirs.push(dir);
	return dir;
}

const runsAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
const canDropWritePermission = process.platform !== "win32" && !runsAsRoot;

describe("checkCreatePrefix", () => {
	it("accepts a prefix that does not exist yet", async () => {
		await expect(checkCreatePrefix(join(scratch(), "envs", "dev"))).resolves.toEqual({
			available: true,
		});
	});

	it("accepts an existing directory that is not a conda environment, as conda does", async () => {
		const empty = join(scratch(), "empty");
		mkdirSync(empty);
		await expect(checkCreatePrefix(empty)).resolves.toEqual({ available: true });

		const withFiles = join(scratch(), "with-files");
		mkdirSync(withFiles);
		writeFileSync(join(withFiles, "README.md"), "hi");
		await expect(checkCreatePrefix(withFiles)).resolves.toEqual({ available: true });
	});

	it("rejects a directory that already holds a conda environment", async () => {
		const env = join(scratch(), "alpha-bet");
		mkdirSync(join(env, "conda-meta"), { recursive: true });
		await expect(checkCreatePrefix(env)).resolves.toEqual({
			available: false,
			reason: "exists-environment",
		});
		await expect(checkCreatePrefix(`${env}/`)).resolves.toEqual({
			available: false,
			reason: "exists-environment",
		});
	});

	it.runIf(process.platform !== "win32")(
		"treats a dangling conda-meta symlink as an existing environment, as conda does",
		async () => {
			const env = join(scratch(), "half-removed");
			mkdirSync(env);
			symlinkSync(join(env, "gone"), join(env, "conda-meta"));
			await expect(checkCreatePrefix(env)).resolves.toEqual({
				available: false,
				reason: "exists-environment",
			});
		},
	);

	it("leaves no write probe behind", async () => {
		const root = scratch();
		const existing = join(root, "existing");
		mkdirSync(existing);
		await expect(checkCreatePrefix(join(root, "new-env"))).resolves.toEqual({ available: true });
		await expect(checkCreatePrefix(existing)).resolves.toEqual({ available: true });
		expect(readdirSync(root)).toEqual(["existing"]);
		expect(readdirSync(existing)).toEqual([]);
	});

	it("rejects a prefix occupied by a file", async () => {
		const file = join(scratch(), "taken");
		writeFileSync(file, "");
		await expect(checkCreatePrefix(file)).resolves.toEqual({
			available: false,
			reason: "exists-file",
		});
	});

	it("rejects conda's reserved environment names", async () => {
		const root = scratch();
		for (const name of ["base", "root"]) {
			await expect(checkCreatePrefix(join(root, name))).resolves.toEqual({
				available: false,
				reason: "reserved-name",
			});
		}
	});

	it("rejects a prefix containing the platform path delimiter", async () => {
		await expect(checkCreatePrefix(join(scratch(), `a${delimiter}b`))).resolves.toEqual({
			available: false,
			reason: "invalid-path",
		});
	});

	it("rejects a relative prefix", async () => {
		await expect(checkCreatePrefix("envs/dev")).resolves.toEqual({
			available: false,
			reason: "invalid-path",
		});
	});

	it("rejects a prefix nested under a file", async () => {
		const file = join(scratch(), "file");
		writeFileSync(file, "");
		await expect(checkCreatePrefix(join(file, "dev"))).resolves.toEqual({
			available: false,
			reason: "invalid-path",
		});
	});

	it.runIf(canDropWritePermission)("rejects a location the user cannot write to", async () => {
		const readOnly = scratch();
		chmodSync(readOnly, 0o500);
		await expect(checkCreatePrefix(join(readOnly, "envs", "dev"))).resolves.toEqual({
			available: false,
			reason: "not-writable",
		});
	});

	it.runIf(canDropWritePermission)(
		"rejects an existing non-environment directory the user cannot write to",
		async () => {
			const readOnly = join(scratch(), "locked");
			mkdirSync(readOnly);
			chmodSync(readOnly, 0o500);
			dirs.push(readOnly);
			await expect(checkCreatePrefix(readOnly)).resolves.toEqual({
				available: false,
				reason: "not-writable",
			});
		},
	);

	it.runIf(canDropWritePermission)(
		"reports a directory it cannot list as inaccessible",
		async () => {
			const unreadable = join(scratch(), "unreadable");
			mkdirSync(unreadable);
			chmodSync(unreadable, 0o300);
			dirs.push(unreadable);
			await expect(checkCreatePrefix(unreadable)).resolves.toEqual({
				available: false,
				reason: "inaccessible",
			});
		},
	);
});
