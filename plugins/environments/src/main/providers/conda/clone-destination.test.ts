import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cloneDestinationParam, isCondaDistributionRoot } from "./clone-destination";

const notRoot = () => false;
const isRoot = () => true;

describe("cloneDestinationParam", () => {
	it("places the clone beside a source that lives in an envs directory", () => {
		expect(
			cloneDestinationParam("/home/user/miniconda3/envs/myenv", "myenv-backup", notRoot),
		).toEqual({ destinationPrefix: "/home/user/miniconda3/envs/myenv-backup" });
	});

	it("tolerates a trailing separator on the source prefix", () => {
		expect(cloneDestinationParam("/home/user/.conda/envs/dev/", "dev-copy", notRoot)).toEqual({
			destinationPrefix: "/home/user/.conda/envs/dev-copy",
		});
	});

	it("places a clone of the base env under the distribution's own envs directory", () => {
		// Deriving from the parent would put the clone at /opt/base-backup;
		// destinationName would hand it to the bridge sidecar's envs_dirs.
		expect(cloneDestinationParam("/opt/miniconda3", "base-backup", isRoot)).toEqual({
			destinationPrefix: "/opt/miniconda3/envs/base-backup",
		});
		expect(cloneDestinationParam("/Users/me/anaconda3/", "base-backup", isRoot)).toEqual({
			destinationPrefix: "/Users/me/anaconda3/envs/base-backup",
		});
	});

	it("falls back to destinationName for a -p prefix outside any envs directory", () => {
		expect(cloneDestinationParam("/projects/myproj/.venv-conda", "copy", notRoot)).toEqual({
			destinationName: "copy",
		});
	});

	it("falls back to destinationName for a filesystem root without consulting the predicate", () => {
		let asked = false;
		const spy = () => {
			asked = true;
			return true;
		};
		expect(cloneDestinationParam("/", "copy", spy)).toEqual({ destinationName: "copy" });
		expect(cloneDestinationParam("C:\\", "copy", spy)).toEqual({ destinationName: "copy" });
		expect(asked).toBe(false);
	});

	it("falls back to destinationName when no sourcePrefix is given", () => {
		expect(cloneDestinationParam(undefined, "copy", isRoot)).toEqual({ destinationName: "copy" });
		expect(cloneDestinationParam("", "copy", isRoot)).toEqual({ destinationName: "copy" });
	});

	it("handles Windows paths, including mixed separators and a base env", () => {
		expect(cloneDestinationParam("C:\\Users\\me\\miniconda3\\envs\\foo", "bar", notRoot)).toEqual({
			destinationPrefix: "C:\\Users\\me\\miniconda3\\envs\\bar",
		});
		expect(cloneDestinationParam("C:/conda/envs\\foo", "bar", notRoot)).toEqual({
			destinationPrefix: "C:\\conda\\envs\\bar",
		});
		expect(cloneDestinationParam("C:\\miniconda3", "base-backup", isRoot)).toEqual({
			destinationPrefix: "C:\\miniconda3\\envs\\base-backup",
		});
	});
});

describe("isCondaDistributionRoot", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});
	function scratch(): string {
		const dir = mkdtempSync(join(tmpdir(), "clone-dest-"));
		dirs.push(dir);
		return dir;
	}

	it("recognises a prefix that carries an envs/ or pkgs/ directory", () => {
		const withEnvs = scratch();
		mkdirSync(join(withEnvs, "envs"));
		expect(isCondaDistributionRoot(withEnvs)).toBe(true);

		const withPkgs = scratch();
		mkdirSync(join(withPkgs, "pkgs"));
		expect(isCondaDistributionRoot(withPkgs)).toBe(true);
	});

	it("rejects an ordinary environment prefix", () => {
		const env = scratch();
		mkdirSync(join(env, "conda-meta"));
		expect(isCondaDistributionRoot(env)).toBe(false);
		expect(isCondaDistributionRoot(join(env, "does-not-exist"))).toBe(false);
	});
});
