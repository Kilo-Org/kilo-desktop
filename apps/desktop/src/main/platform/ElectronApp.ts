import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

import { app, type App, type RelaunchOptions } from "electron";

import { getAppIdentity, type AppEnvironment, type AppIdentity } from "$config/app-identity.js";

import { resolveSharedProfile, type SharedProfile } from "./sharedProfile.js";

export interface ElectronAppMetadata {
	readonly appPath: string;
	readonly appVersion: string;
	readonly isPackaged: boolean;
	readonly resourcesPath: string;
	readonly runningUnderArm64Translation: boolean;
}

const LEGACY_PROFILE_NAMES = {
	development: ["Anaconda Agentic Desktop Dev", "Kilo Dev"],
	preview: [
		"Anaconda Agentic Desktop Canary",
		"Anaconda Agentic Desktop Staging",
		"Anaconda Agentic Desktop",
		"Kilo Preview",
	],
	stable: ["Anaconda Agentic Desktop"],
} as const satisfies Readonly<Record<AppEnvironment, readonly string[]>>;

export function migrateAppProfile(
	appDataDirectory: string,
	environment: AppEnvironment,
	targetName: string,
	exists: (path: string) => boolean = existsSync,
	rename: (oldPath: string, newPath: string) => void = renameSync,
): string | undefined {
	const target = path.join(appDataDirectory, targetName);
	if (exists(target)) return undefined;

	for (const sourceName of LEGACY_PROFILE_NAMES[environment]) {
		const source = path.join(appDataDirectory, sourceName);
		if (!exists(source)) continue;
		rename(source, target);
		return source;
	}
	return undefined;
}

export function configureAppProfile(
	electronApp: App = app,
	makeDirectory: (directory: string) => void = (directory) => {
		mkdirSync(directory, { recursive: true });
	},
	environment: AppEnvironment = electronApp.isPackaged ? RELEASE_TRACK : "development",
	argv: readonly string[] = process.argv,
	resolveProfile: typeof resolveSharedProfile = resolveSharedProfile,
): Pick<SharedProfile, "formerRoots"> {
	const identity = getAppIdentity(environment);
	electronApp.setName(identity.productName);
	if (
		argv.some(
			(argument) => argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
		)
	) {
		return { formerRoots: [] };
	}

	const appData = electronApp.getPath("appData");
	const { userData, formerRoots } = resolveProfile(appData, environment, identity.userDataName);
	migrateAppProfile(appData, environment, path.basename(userData));
	makeDirectory(userData);
	electronApp.setPath("userData", userData);
	return { formerRoots };
}

export class ElectronApp {
	constructor(private readonly electronApp: App = app) {}

	get metadata(): ElectronAppMetadata {
		return {
			appPath: this.electronApp.getAppPath(),
			appVersion: this.electronApp.getVersion(),
			isPackaged: this.electronApp.isPackaged,
			resourcesPath: process.resourcesPath,
			runningUnderArm64Translation: this.electronApp.runningUnderARM64Translation === true,
		};
	}

	whenReady(): Promise<void> {
		return this.electronApp.whenReady();
	}

	getPath(name: Parameters<App["getPath"]>[0]): string {
		return this.electronApp.getPath(name);
	}

	requestSingleInstanceLock(): boolean {
		return this.electronApp.requestSingleInstanceLock();
	}

	setIdentity(identity: AppIdentity): void {
		this.electronApp.setName(identity.productName);
		this.electronApp.setAppUserModelId(
			process.platform === "win32" ? identity.windowsAppUserModelId : identity.appBundleId,
		);
	}

	quit(): void {
		this.electronApp.quit();
	}

	exit(code: number): void {
		this.electronApp.exit(code);
	}

	relaunch(options: RelaunchOptions = {}): void {
		this.electronApp.relaunch(options);
	}

	on<TArguments extends unknown[]>(
		eventName: string,
		listener: (...arguments_: TArguments) => void,
	): () => void {
		this.electronApp.on(eventName as never, listener as never);
		return () => {
			this.electronApp.removeListener(eventName as never, listener as never);
		};
	}

	setAsDefaultProtocolClient(
		scheme: string,
		argv: readonly string[] = process.argv,
		execPath: string = process.execPath,
		defaultApp: boolean = process.defaultApp === true,
	): boolean {
		if (defaultApp) {
			const script = argv[1];
			if (!script) return this.electronApp.setAsDefaultProtocolClient(scheme);
			return this.electronApp.setAsDefaultProtocolClient(scheme, execPath, [path.resolve(script)]);
		}
		return this.electronApp.setAsDefaultProtocolClient(scheme);
	}
}
