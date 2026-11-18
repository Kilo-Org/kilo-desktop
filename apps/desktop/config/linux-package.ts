import { readFileSync } from "node:fs";
import path from "node:path";

export type LinuxPackageFormat = "deb" | "rpm";

/**
 * File in the app's `resources/` folder naming the package format that
 * installed it. Both Linux packages wrap the same Forge output, so only the RPM
 * spec writes this marker; its absence means a DEB (or unpackaged) install.
 */
export const LINUX_PACKAGE_FORMAT_FILE = "package-format";

/**
 * RPM `Version` forbids `-`. A semver prerelease becomes an RPM pre-release
 * (`~`), which sorts before the bare version, so dnf orders Preview and Stable
 * builds the way the in-app updater does.
 */
export function getRpmVersion(version: string): string {
	const match = /^(?<core>\d+\.\d+\.\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/.exec(version);
	if (!match?.groups) throw new Error(`Invalid app version: ${version}`);
	const { core, prerelease } = match.groups;
	return prerelease ? `${core}~${prerelease.replaceAll("-", ".")}` : core!;
}

/** Read once at startup, before the updater is created, so it stays synchronous. */
export function readLinuxPackageFormat(resourcesPath: string): LinuxPackageFormat {
	let marker: string;
	try {
		marker = readFileSync(path.join(resourcesPath, LINUX_PACKAGE_FORMAT_FILE), "utf8").trim();
	} catch {
		return "deb";
	}
	return marker === "rpm" ? "rpm" : "deb";
}
