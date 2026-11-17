import { describe, expect, it } from "vitest";

import { packageInstallLinkTelemetry, readPackageInstallLink } from "./package-install-link";

const install = (search: Record<string, string>) =>
	readPackageInstallLink({ packageAction: "install", ...search });

describe("readPackageInstallLink", () => {
	it("is null for a page visit that is not an install link", () => {
		expect(readPackageInstallLink({})).toBeNull();
		expect(readPackageInstallLink({ env: "/opt/conda/envs/dev" })).toBeNull();
	});

	it("reads a package with its source", () => {
		expect(install({ package: "numpy", source: "dot-org" })).toEqual({
			kind: "install",
			package: "numpy",
			spec: "numpy",
			source: "dot-org",
		});
	});

	it("trims the package and pins a version as name=version", () => {
		expect(install({ package: "  numpy ", version: " 1.26.4 " })).toEqual({
			kind: "install",
			package: "numpy",
			version: "1.26.4",
			spec: "numpy=1.26.4",
		});
		expect(install({ package: "pytorch", version: "1!2.0.0+cpu" })).toMatchObject({
			spec: "pytorch=1!2.0.0+cpu",
		});
		expect(install({ package: "numpy", version: "" })).toEqual({
			kind: "install",
			package: "numpy",
			spec: "numpy",
		});
	});

	it("reads anaconda.org's main channel as conda's default channels, not conda's bare main", () => {
		expect(install({ package: "numpy", channel: "main" })).toMatchObject({ channel: "defaults" });
		expect(install({ package: "numpy", channel: "conda-forge" })).toMatchObject({
			channel: "conda-forge",
		});
		expect(install({ package: "numpy", channel: " bioconda/label/dev " })).toMatchObject({
			channel: "bioconda/label/dev",
		});
		expect(install({ package: "numpy", channel: "" })).not.toHaveProperty("channel");
	});

	it("rejects a link without a package", () => {
		expect(install({})).toEqual({ kind: "invalid", reason: "missing-package" });
		expect(install({ package: "   ", source: "dot-org" })).toEqual({
			kind: "invalid",
			reason: "missing-package",
			source: "dot-org",
		});
	});

	it("rejects a package that is not a plain package name", () => {
		for (const bad of [
			"--override-channels",
			"numpy>=1.24",
			"conda-forge::numpy",
			"num py",
			"numpy\n--all",
			"/tmp/pkg.tar.bz2",
			"https://evil.example/pkg.conda",
			"a".repeat(257),
		]) {
			expect(install({ package: bad })).toEqual({ kind: "invalid", reason: "invalid-package" });
		}
	});

	it("rejects a version with whitespace or operators", () => {
		for (const bad of ["1.26 4", ">=1.24", "1.24,<2", "1.*", "1.2|1.3", "=1.2", "-1"]) {
			expect(install({ package: "numpy", version: bad })).toEqual({
				kind: "invalid",
				reason: "invalid-version",
			});
		}
	});

	it("rejects a flag-like channel or one on this device", () => {
		for (const bad of ["--override-channels", "file:///tmp/channel", "/tmp/channel", "~/c"]) {
			expect(install({ package: "numpy", channel: bad })).toEqual({
				kind: "invalid",
				reason: "invalid-channel",
			});
		}
	});

	it("rejects the Windows and network paths conda reads as local", () => {
		for (const bad of [
			"\\\\attacker.example\\share\\channel",
			"\\\\?\\C:\\channels\\evil",
			"//attacker.example/share",
			"C:\\channels",
			"c:/channels",
			"FILE:///tmp/channel",
			"../channel",
		]) {
			expect(install({ package: "numpy", channel: bad })).toEqual({
				kind: "invalid",
				reason: "invalid-channel",
			});
		}
	});

	it("rejects a channel with characters conda or the bridge could read differently", () => {
		for (const bad of [
			// The bridge strips Python whitespace, which includes these but JavaScript's trim does not.
			"\u0085file:///tmp/channel",
			"\u001cfile:///tmp/channel",
			"\u200bconda-forge",
			"conda-forge\u00a0--override-channels",
			"s3://bucket/channel",
		]) {
			expect(install({ package: "numpy", channel: bad })).toEqual({
				kind: "invalid",
				reason: "invalid-channel",
			});
		}
	});

	it("accepts an http(s) channel URL", () => {
		expect(
			install({ package: "numpy", channel: "https://repo.anaconda.cloud/repo/main-x" }),
		).toMatchObject({ kind: "install", channel: "https://repo.anaconda.cloud/repo/main-x" });
	});

	it("rejects a package or version that conda would read as a package file", () => {
		for (const bad of ["evil.conda", "evil.tar.bz2", "EVIL.TAR.BZ2"]) {
			expect(install({ package: bad })).toEqual({ kind: "invalid", reason: "invalid-package" });
		}
		for (const bad of ["1.0.conda", "1.0.tar.bz2"]) {
			expect(install({ package: "numpy", version: bad })).toEqual({
				kind: "invalid",
				reason: "invalid-version",
			});
		}
	});

	it("rejects actions other than install", () => {
		expect(readPackageInstallLink({ packageAction: "remove", package: "numpy" })).toEqual({
			kind: "invalid",
			reason: "unsupported-action",
		});
		expect(readPackageInstallLink({ package: "numpy" })).toEqual({
			kind: "invalid",
			reason: "unsupported-action",
		});
	});
});

describe("packageInstallLinkTelemetry", () => {
	it("reports what a link carried, never its package or channel", () => {
		const link = install({
			package: "numpy",
			version: "1.26.4",
			channel: "main",
			source: "dot-org",
		});
		expect(packageInstallLinkTelemetry(link!)).toEqual({
			event: "package-install-link-received",
			data: { hasVersion: true, hasChannel: true, source: "dot-org" },
		});
		expect(packageInstallLinkTelemetry(install({ package: "numpy" })!)).toEqual({
			event: "package-install-link-received",
			data: { hasVersion: false, hasChannel: false, source: "none" },
		});
	});

	it("reports a rejection by its reason, and an unknown source only as other", () => {
		const link = install({ package: "numpy", channel: "--x", source: "evil.example?user=me" });
		expect(packageInstallLinkTelemetry(link!)).toEqual({
			event: "package-install-link-rejected",
			data: { reason: "invalid-channel", source: "other" },
		});
	});
});
