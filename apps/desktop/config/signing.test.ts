import { describe, expect, it, vi } from "vitest";

import {
	planWindowsSigning,
	resolveOsxNotarize,
	resolveOsxSign,
	resolveWindowsSigning,
} from "./signing.js";

describe("signing strategy resolution", () => {
	it("resolves macOS sign and notarize from environment", () => {
		expect(resolveOsxSign({})).toBeUndefined();
		expect(
			resolveOsxSign({ APPLE_SIGNING_IDENTITY: " Developer ID Application: Example " }),
		).toEqual({
			identity: "Developer ID Application: Example",
		});

		expect(
			resolveOsxNotarize({
				APPLE_API_KEY: "/tmp/key.p8",
				APPLE_API_KEY_ID: "KEYID",
				APPLE_API_ISSUER: "issuer-uuid",
			}),
		).toEqual({
			appleApiKey: "/tmp/key.p8",
			appleApiKeyId: "KEYID",
			appleApiIssuer: "issuer-uuid",
		});

		expect(
			resolveOsxNotarize({
				APPLE_ID: "dev@example.com",
				APPLE_APP_SPECIFIC_PASSWORD: "app-password",
				APPLE_TEAM_ID: "TEAMID",
			}),
		).toEqual({
			appleId: "dev@example.com",
			appleIdPassword: "app-password",
			teamId: "TEAMID",
		});
	});

	it("prefers Azure Windows signing over a local certificate", () => {
		expect(
			resolveWindowsSigning({
				AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
				AZURE_CERT_NAME: "codesign",
				WINDOWS_CERTIFICATE_FILE: "certificate.pfx",
				WINDOWS_CERTIFICATE_PASSWORD: "secret",
			}),
		).toEqual({ mode: "azure" });
	});

	it("requires certificate file and password for certificate mode", () => {
		expect(
			resolveWindowsSigning({
				WINDOWS_CERTIFICATE_FILE: "certificate.pfx",
			}),
		).toEqual({ mode: "none" });
		expect(
			resolveWindowsSigning({
				WINDOWS_CERTIFICATE_FILE: "certificate.pfx",
				WINDOWS_CERTIFICATE_PASSWORD: "secret",
			}),
		).toEqual({
			mode: "certificate",
			certificateFile: "certificate.pfx",
			certificatePassword: "secret",
		});
	});

	it("plans packager, squirrel, and postMake behavior from one strategy", () => {
		const signFile = vi.fn(async () => undefined);

		expect(
			planWindowsSigning(
				{
					AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
					AZURE_CERT_NAME: "codesign",
				},
				signFile,
			),
		).toEqual({
			packager: { hookFunction: signFile },
			postMakeSign: true,
		});

		expect(
			planWindowsSigning(
				{
					WINDOWS_CERTIFICATE_FILE: "certificate.pfx",
					WINDOWS_CERTIFICATE_PASSWORD: "secret",
				},
				signFile,
			),
		).toEqual({
			packager: {
				certificateFile: "certificate.pfx",
				certificatePassword: "secret",
			},
			squirrelCertificate: {
				certificateFile: "certificate.pfx",
				certificatePassword: "secret",
			},
			postMakeSign: false,
		});

		expect(planWindowsSigning({}, signFile)).toEqual({ postMakeSign: false });
	});
});
