import { describe, expect, it, vi } from "vitest";

import { brandSquirrelUninstallEntry } from "./SquirrelUninstallIcon.js";

const installRoot = String.raw`C:\Users\dev\AppData\Local\KiloDesktop`;
const resourcesPath = String.raw`${installRoot}\app-0.1.8\resources`;
const execPath = String.raw`${installRoot}\app-0.1.8\kilo-desktop.exe`;
const appIcon = String.raw`${installRoot}\app.ico`;
const uninstallKey = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\KiloDesktop`;

function brand(argv: readonly string[]) {
	const copyFile = vi.fn();
	const runCommand = vi.fn();
	brandSquirrelUninstallEntry({
		argv: ["kilo-desktop.exe", ...argv],
		execPath,
		resourcesPath,
		squirrelName: "KiloDesktop",
		copyFile,
		runCommand,
	});
	return { copyFile, runCommand };
}

describe("brandSquirrelUninstallEntry", () => {
	it.each(["--squirrel-install", "--squirrel-updated"])(
		"replaces the Squirrel app icon and points the uninstall entry at it on %s",
		(event) => {
			const { copyFile, runCommand } = brand([event, "0.1.8"]);

			expect(copyFile).toHaveBeenCalledWith(String.raw`${resourcesPath}\icon.ico`, appIcon);
			expect(runCommand).toHaveBeenCalledWith("reg.exe", [
				"add",
				uninstallKey,
				"/v",
				"DisplayIcon",
				"/t",
				"REG_SZ",
				"/d",
				appIcon,
				"/f",
			]);
		},
	);

	it.each([[[]], [["--squirrel-firstrun"]], [["--squirrel-uninstall", "0.1.8"]]])(
		"leaves the install untouched for argv %j",
		(argv) => {
			const { copyFile, runCommand } = brand(argv);

			expect(copyFile).not.toHaveBeenCalled();
			expect(runCommand).not.toHaveBeenCalled();
		},
	);

	it("does not repoint the uninstall entry when the icon cannot be copied", () => {
		const runCommand = vi.fn();

		expect(() =>
			brandSquirrelUninstallEntry({
				argv: ["kilo-desktop.exe", "--squirrel-install", "0.1.8"],
				execPath,
				resourcesPath,
				squirrelName: "KiloDesktop",
				copyFile: () => {
					throw new Error("EACCES");
				},
				runCommand,
			}),
		).not.toThrow();
		expect(runCommand).not.toHaveBeenCalled();
	});

	it("never fails the Squirrel hook when the registry write fails", () => {
		expect(() =>
			brandSquirrelUninstallEntry({
				argv: ["kilo-desktop.exe", "--squirrel-updated", "0.1.8"],
				execPath,
				resourcesPath,
				squirrelName: "KiloDesktop",
				copyFile: vi.fn(),
				runCommand: () => {
					throw new Error("reg.exe exited with code 1");
				},
			}),
		).not.toThrow();
	});
});
