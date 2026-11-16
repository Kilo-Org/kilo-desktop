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

// Matches the copyright line of the root LICENSE.md.
const COPYRIGHT_HOLDER = "Anaconda, Inc.";
const FIRST_COPYRIGHT_YEAR = 2026;

export function getAppCopyright(buildTime: Date): string {
	const year = buildTime.getUTCFullYear();
	const years = year > FIRST_COPYRIGHT_YEAR ? `${FIRST_COPYRIGHT_YEAR}–${year}` : `${year}`;
	return `Copyright © ${years} ${COPYRIGHT_HOLDER}`;
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

// The built installer carries version and arch like the DMG does; the
// unversioned setupExecutableName stays the stable "latest" download alias.
export function getVersionedSetupExecutableName(
	identity: AppIdentity,
	version: string,
	arch: string,
): string {
	return identity.setupExecutableName.replace(/-Setup\.exe$/, `-${version}-${arch}-Setup.exe`);
}

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
