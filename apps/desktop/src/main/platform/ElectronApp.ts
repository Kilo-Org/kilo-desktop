import { app, type App, type RelaunchOptions } from "electron";

import type { AppIdentity } from "$config/app-identity.js";

export interface ElectronAppMetadata {
	readonly appPath: string;
	readonly appVersion: string;
	readonly isPackaged: boolean;
	readonly resourcesPath: string;
	readonly runningUnderArm64Translation: boolean;
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
}
