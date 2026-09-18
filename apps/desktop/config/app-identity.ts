import type { ReleaseTrack } from "./release.js";

const BASE_BUNDLE_ID = "ai.kilo.desktop";
const BASE_EXECUTABLE_NAME = "kilo-desktop";
const BASE_SQUIRREL_NAME = "KiloDesktop";

export type AppEnvironment = "development" | ReleaseTrack;

export interface AppIdentity {
	readonly appBundleId: string;
	readonly environment: AppEnvironment;
	readonly executableName: string;
	readonly productName: string;
	readonly setupExecutableName: string;
	readonly squirrelName: string;
	readonly userDataName: string;
	readonly windowsAppUserModelId: string;
}

export function getDmgVolumeTitle(track: ReleaseTrack): string {
	return track === "preview" ? "Kilo Preview" : "Kilo";
}

const PRODUCT_NAMES = {
	development: "Kilo Dev",
	preview: "Kilo Preview",
	stable: "Kilo",
} as const satisfies Readonly<Record<AppEnvironment, string>>;

const USER_DATA_NAMES = {
	development: "Kilo Desktop Dev",
	preview: "Kilo Desktop Preview",
	stable: "Kilo Desktop",
} as const satisfies Readonly<Record<AppEnvironment, string>>;

export function getAppIdentity(environment: AppEnvironment): AppIdentity {
	const machineSuffix = environment === "development" ? "dev" : undefined;
	const productName = PRODUCT_NAMES[environment];
	const executableName = machineSuffix
		? `${BASE_EXECUTABLE_NAME}-${machineSuffix}`
		: BASE_EXECUTABLE_NAME;
	const squirrelName = `${BASE_SQUIRREL_NAME}${machineSuffix === "dev" ? "Dev" : ""}`;

	return {
		appBundleId: machineSuffix ? `${BASE_BUNDLE_ID}.${machineSuffix}` : BASE_BUNDLE_ID,
		environment,
		executableName,
		productName,
		setupExecutableName: `${productName.replaceAll(" ", "-")}-Setup.exe`,
		squirrelName,
		userDataName: USER_DATA_NAMES[environment],
		windowsAppUserModelId: `com.squirrel.${squirrelName}.${executableName}`,
	};
}
