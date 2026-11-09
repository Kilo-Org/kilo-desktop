import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stageBridge } from "./stage-bridge.js";

/** Mode bits are meaningless on Windows, so chmod assertions only run on POSIX. */
const onPosix = process.platform !== "win32";

const tempDirs: string[] = [];

beforeEach(() => {
	// stageBridge is chatty by design (it runs as a build step); keep the test
	// output readable while still allowing assertions on what it reported.
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

interface PayloadOptions {
	/** Inventory field(s) to emit. Mirrors the `macho` → `natives` rename. */
	readonly inventoryField?: "natives" | "macho" | "both" | "none";
	readonly version?: string;
}

/**
 * Build a fake payload directory: a launch interpreter plus one shared object,
 * both written WITHOUT the +x bit so the chmod pass in stageBridge is
 * observable. This is exactly the state pnpm's hardlinking can leave behind.
 */
function makePayload(options: PayloadOptions = {}): string {
	const { inventoryField = "natives", version = "0.1.7" } = options;
	const root = makeTempDir("bridge-payload-");

	const binary = path.join(root, "python", "bin", "python3.11");
	mkdirSync(path.dirname(binary), { recursive: true });
	writeFileSync(binary, "#!/bin/sh\n");
	chmodSync(binary, 0o644);

	const library = path.join(root, "lib", "libssl.so");
	mkdirSync(path.dirname(library), { recursive: true });
	writeFileSync(library, "binary\n");
	chmodSync(library, 0o644);

	const inventory = ["python/bin/python3.11", "lib/libssl.so"];
	const manifest: Record<string, unknown> = {
		schema: 1,
		target: "linux-x64",
		python_version: "3.11.12",
		bridge_version: version,
		launch: ["python/bin/python3.11", "-E", "-s", "-m", "anaconda_desktop_bridge"],
		packages: {},
	};
	if (inventoryField === "natives" || inventoryField === "both") {
		manifest["natives"] = inventory;
	}
	if (inventoryField === "macho" || inventoryField === "both") {
		manifest["macho"] = inventory;
	}
	writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));

	return root;
}

function mode(filePath: string): number {
	return statSync(filePath).mode & 0o777;
}

describe("stageBridge", () => {
	it("copies the payload and reports the staged version", async () => {
		const sourcePath = makePayload();
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		const result = await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		expect(result.staged).toBe(true);
		expect(result.version).toBe("0.1.7");
		expect(existsSync(path.join(resourceRoot, "manifest.json"))).toBe(true);
		expect(existsSync(path.join(resourceRoot, "python", "bin", "python3.11"))).toBe(true);
		expect(existsSync(path.join(resourceRoot, "lib", "libssl.so"))).toBe(true);
	});

	it.skipIf(!onPosix)("chmods every entry in the natives inventory", async () => {
		const sourcePath = makePayload({ inventoryField: "natives" });
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		expect(mode(path.join(resourceRoot, "python", "bin", "python3.11"))).toBe(0o755);
		expect(mode(path.join(resourceRoot, "lib", "libssl.so"))).toBe(0o755);
	});

	it.skipIf(!onPosix)(
		"falls back to the legacy macho inventory when natives is absent",
		async () => {
			// The whole point of the fallback: a pre-rename payload must still
			// come out executable.
			const sourcePath = makePayload({ inventoryField: "macho" });
			const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

			await stageBridge({ resourceRoot, sourcePath, platform: "darwin" });

			expect(mode(path.join(resourceRoot, "lib", "libssl.so"))).toBe(0o755);
		},
	);

	it.skipIf(!onPosix)(
		"still chmods the launch entry point when the inventory is missing entirely",
		async () => {
			const sourcePath = makePayload({ inventoryField: "none" });
			const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

			await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

			expect(mode(path.join(resourceRoot, "python", "bin", "python3.11"))).toBe(0o755);
			// Not listed anywhere, so it stays as copied.
			expect(mode(path.join(resourceRoot, "lib", "libssl.so"))).toBe(0o644);
		},
	);

	it("warns when the payload carries no native binary inventory", async () => {
		const sourcePath = makePayload({ inventoryField: "none" });
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining("no native binary inventory"),
		);
	});

	it("does not promise a chmod that will not happen on win32", async () => {
		// The chmod pass is skipped entirely on Windows, so the POSIX wording
		// ("only the launch entry point") would be false there.
		const sourcePath = makePayload({ inventoryField: "none" });
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await stageBridge({ resourceRoot, sourcePath, platform: "win32", arch: "x64" });

		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining("no native binary inventory"),
		);
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("does not run on Windows"));
		expect(console.warn).not.toHaveBeenCalledWith(
			expect.stringContaining("launch entry point will be made executable"),
		);
	});

	it("does not warn when the payload carries both inventory fields", async () => {
		const sourcePath = makePayload({ inventoryField: "both" });
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		expect(console.warn).not.toHaveBeenCalled();
	});

	it.skipIf(!onPosix)("skips the chmod pass on win32", async () => {
		const sourcePath = makePayload();
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await stageBridge({ resourceRoot, sourcePath, platform: "win32", arch: "x64" });

		// chmod on Windows only toggles the read-only attribute, so the pass is
		// skipped; the copied modes are left untouched.
		expect(mode(path.join(resourceRoot, "python", "bin", "python3.11"))).toBe(0o644);
		expect(mode(path.join(resourceRoot, "lib", "libssl.so"))).toBe(0o644);
	});

	it("is idempotent for an unchanged version", async () => {
		const sourcePath = makePayload();
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		const first = await stageBridge({ resourceRoot, sourcePath, platform: "linux" });
		const second = await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		expect(first.staged).toBe(true);
		expect(second.staged).toBe(false);
		expect(second.version).toBe("0.1.7");
	});

	it("re-stages when the payload version changes", async () => {
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");
		await stageBridge({
			resourceRoot,
			sourcePath: makePayload({ version: "0.1.7" }),
			platform: "linux",
		});

		const result = await stageBridge({
			resourceRoot,
			sourcePath: makePayload({ version: "0.1.8" }),
			platform: "linux",
		});

		expect(result.staged).toBe(true);
		expect(result.version).toBe("0.1.8");
	});

	it.skipIf(!onPosix)("re-stages when the staged launch binary lost its +x bit", async () => {
		const sourcePath = makePayload();
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");
		await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		// Simulate a clean/hardlink that stripped the bit but left the marker.
		chmodSync(path.join(resourceRoot, "python", "bin", "python3.11"), 0o644);

		const result = await stageBridge({ resourceRoot, sourcePath, platform: "linux" });
		expect(result.staged).toBe(true);
		expect(mode(path.join(resourceRoot, "python", "bin", "python3.11"))).toBe(0o755);
	});

	it("re-stages when the staged payload was partially removed", async () => {
		const sourcePath = makePayload();
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");
		await stageBridge({ resourceRoot, sourcePath, platform: "linux" });

		rmSync(path.join(resourceRoot, "python"), { recursive: true, force: true });

		const result = await stageBridge({ resourceRoot, sourcePath, platform: "linux" });
		expect(result.staged).toBe(true);
		expect(existsSync(path.join(resourceRoot, "python", "bin", "python3.11"))).toBe(true);
	});

	it("skips gracefully when no payload package exists for the platform", async () => {
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		const result = await stageBridge({ resourceRoot, platform: "win32", arch: "ia32" });

		expect(result.staged).toBe(false);
		expect(result.version).toBe("none");
		expect(existsSync(resourceRoot)).toBe(false);
	});

	it("throws when the override path has no manifest", async () => {
		const sourcePath = makeTempDir("bridge-empty-");
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await expect(stageBridge({ resourceRoot, sourcePath, platform: "linux" })).rejects.toThrow(
			/does not contain a manifest\.json/,
		);
	});

	it("throws when the payload manifest is malformed", async () => {
		const sourcePath = makeTempDir("bridge-bad-");
		writeFileSync(path.join(sourcePath, "manifest.json"), JSON.stringify({ schema: 1 }));
		const resourceRoot = path.join(makeTempDir("bridge-stage-"), "bridge");

		await expect(stageBridge({ resourceRoot, sourcePath, platform: "linux" })).rejects.toThrow(
			/malformed/,
		);
	});
});
