/*
 * Windows "Installed apps" reads the icon from the Squirrel uninstall entry's
 * DisplayIcon, which Squirrel points at `<install root>\app.ico`. Squirrel only
 * populates that file by downloading the nuspec `iconUrl`, and
 * electron-winstaller defaults `iconUrl` to Electron's icon — so every install
 * shows the Electron logo. There is no public URL to host our icon at, and the
 * file is never re-downloaded once present, so a config-only fix would not
 * repair existing installs either.
 *
 * Instead, the install/update hooks copy the bundled `icon.ico` over `app.ico`
 * and point DisplayIcon at it. Squirrel runs these hooks before it writes the
 * uninstall entry, and it skips the download (and leaves DisplayIcon alone)
 * when `app.ico` already exists, so our icon wins on fresh installs and
 * self-heals existing ones on their next update.
 *
 * Everything is synchronous because electron-squirrel-startup quits the app as
 * soon as the event loop drains, and best-effort because a cosmetic icon must
 * never fail an install.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import path from "node:path";

const BRANDED_EVENTS = new Set(["--squirrel-install", "--squirrel-updated"]);
const UNINSTALL_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`;

export interface SquirrelUninstallIconOptions {
	readonly argv: readonly string[];
	/** `<install root>\app-<version>\<exe>`; Squirrel's root is two levels up. */
	readonly execPath: string;
	readonly resourcesPath: string;
	readonly squirrelName: string;
	readonly copyFile?: (source: string, destination: string) => void;
	readonly runCommand?: (file: string, args: readonly string[]) => void;
}

export function brandSquirrelUninstallEntry({
	argv,
	execPath,
	resourcesPath,
	squirrelName,
	copyFile = copyFileSync,
	runCommand = (file, args) => {
		execFileSync(file, args, { stdio: "ignore", windowsHide: true });
	},
}: SquirrelUninstallIconOptions): void {
	const event = argv[1];
	if (!event || !BRANDED_EVENTS.has(event)) return;

	const installRoot = path.win32.dirname(path.win32.dirname(execPath));
	const appIcon = path.win32.join(installRoot, "app.ico");
	try {
		copyFile(path.win32.join(resourcesPath, "icon.ico"), appIcon);
		runCommand("reg.exe", [
			"add",
			`${UNINSTALL_KEY}\\${squirrelName}`,
			"/v",
			"DisplayIcon",
			"/t",
			"REG_SZ",
			"/d",
			appIcon,
			"/f",
		]);
	} catch {
		// Cosmetic only; Squirrel falls back to its own icon handling.
	}
}
