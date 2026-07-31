import type { PublishableReleaseChannel } from "./release.js";

const BASE_BUNDLE_ID = "com.anaconda.agentic-desktop";
const BASE_EXECUTABLE_NAME = "anaconda-agentic-desktop";
const BASE_PRODUCT_NAME = "Anaconda Agentic Desktop";
const BASE_SQUIRREL_NAME = "AnacondaAgenticDesktop";

export type AppEnvironment = "development" | PublishableReleaseChannel;

export interface AppIdentity {
	readonly appBundleId: string;
	readonly environment: AppEnvironment;
	readonly executableName: string;
	readonly productName: string;
	readonly setupExecutableName: string;
	readonly squirrelName: string;
	readonly windowsAppUserModelId: string;
}

const ENVIRONMENT_SUFFIXES = {
	development: "Dev",
	canary: "Canary",
	staging: "Staging",
	prod: undefined,
} as const satisfies Readonly<Record<AppEnvironment, string | undefined>>;

export function getAppIdentity(environment: AppEnvironment): AppIdentity {
	const suffix = ENVIRONMENT_SUFFIXES[environment];
	const machineSuffix = suffix?.toLowerCase();
	const productName = suffix ? `${BASE_PRODUCT_NAME} ${suffix}` : BASE_PRODUCT_NAME;
	const executableName = machineSuffix
		? `${BASE_EXECUTABLE_NAME}-${machineSuffix}`
		: BASE_EXECUTABLE_NAME;
	const squirrelName = `${BASE_SQUIRREL_NAME}${suffix ?? ""}`;

	return {
		appBundleId: machineSuffix ? `${BASE_BUNDLE_ID}.${machineSuffix}` : BASE_BUNDLE_ID,
		environment,
		executableName,
		productName,
		setupExecutableName: `${productName.replaceAll(" ", "-")}-Setup.exe`,
		squirrelName,
		windowsAppUserModelId: `com.squirrel.${squirrelName}.${executableName}`,
	};
}
