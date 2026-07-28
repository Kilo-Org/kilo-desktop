import { hasAzureWindowsSigningCredentials, signWindowsFile } from "./windows-sign.js";

export interface SigningEnvironment {
	readonly APPLE_API_ISSUER?: string;
	readonly APPLE_API_KEY?: string;
	readonly APPLE_API_KEY_ID?: string;
	readonly APPLE_APP_SPECIFIC_PASSWORD?: string;
	readonly APPLE_ID?: string;
	readonly APPLE_SIGNING_IDENTITY?: string;
	readonly APPLE_TEAM_ID?: string;
	readonly AZURE_CERT_NAME?: string;
	readonly AZURE_KEY_VAULT_URI?: string;
	readonly WINDOWS_CERTIFICATE_FILE?: string;
	readonly WINDOWS_CERTIFICATE_PASSWORD?: string;
}

export type OsxNotarize =
	| {
			readonly appleApiKey: string;
			readonly appleApiKeyId: string;
			readonly appleApiIssuer: string;
	  }
	| {
			readonly appleId: string;
			readonly appleIdPassword: string;
			readonly teamId: string;
	  };

export type WindowsSigning =
	| { readonly mode: "azure" }
	| {
			readonly mode: "certificate";
			readonly certificateFile: string;
			readonly certificatePassword: string;
	  }
	| { readonly mode: "none" };

export type PackagerWindowsSign =
	| { readonly hookFunction: (fileToSign: string) => Promise<void> }
	| { readonly certificateFile: string; readonly certificatePassword: string };

export type WindowsSigningPlan = {
	readonly packager?: PackagerWindowsSign;
	readonly squirrelCertificate?: {
		readonly certificateFile: string;
		readonly certificatePassword: string;
	};
	readonly postMakeSign: boolean;
};

export function resolveOsxSign(
	environment: SigningEnvironment = {},
): { readonly identity: string } | undefined {
	const identity = environment.APPLE_SIGNING_IDENTITY?.trim();
	return identity ? { identity } : undefined;
}

export function resolveOsxNotarize(environment: SigningEnvironment = {}): OsxNotarize | undefined {
	const appleApiKey = environment.APPLE_API_KEY?.trim();
	const appleApiKeyId = environment.APPLE_API_KEY_ID?.trim();
	const appleApiIssuer = environment.APPLE_API_ISSUER?.trim();
	if (appleApiKey && appleApiKeyId && appleApiIssuer) {
		return { appleApiKey, appleApiKeyId, appleApiIssuer };
	}

	const appleId = environment.APPLE_ID?.trim();
	const appleIdPassword = environment.APPLE_APP_SPECIFIC_PASSWORD?.trim();
	const teamId = environment.APPLE_TEAM_ID?.trim();
	if (appleId && appleIdPassword && teamId) {
		return { appleId, appleIdPassword, teamId };
	}

	return undefined;
}

export function resolveWindowsSigning(environment: SigningEnvironment = {}): WindowsSigning {
	if (hasAzureWindowsSigningCredentials(environment)) {
		return { mode: "azure" };
	}

	const certificateFile = environment.WINDOWS_CERTIFICATE_FILE?.trim();
	const certificatePassword = environment.WINDOWS_CERTIFICATE_PASSWORD;
	if (certificateFile && certificatePassword) {
		return {
			mode: "certificate",
			certificateFile,
			certificatePassword,
		};
	}

	return { mode: "none" };
}

export function planWindowsSigning(
	environment: SigningEnvironment = {},
	signFile: (filePath: string) => Promise<void> = signWindowsFile,
): WindowsSigningPlan {
	const signing = resolveWindowsSigning(environment);
	switch (signing.mode) {
		case "azure":
			return {
				packager: { hookFunction: signFile },
				postMakeSign: true,
			};
		case "certificate":
			return {
				packager: {
					certificateFile: signing.certificateFile,
					certificatePassword: signing.certificatePassword,
				},
				squirrelCertificate: {
					certificateFile: signing.certificateFile,
					certificatePassword: signing.certificatePassword,
				},
				postMakeSign: false,
			};
		case "none":
			return { postMakeSign: false };
		default: {
			const _exhaustive: never = signing;
			return _exhaustive;
		}
	}
}
