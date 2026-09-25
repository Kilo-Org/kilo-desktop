import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import { CONTRIBUTION_SOURCE_ID, MCP_ENV_VAR } from "./AnacondaMcpService.js";
import { mainRegister } from "./index.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("anaconda-mcp main registration", () => {
	it("does not finish boot until its initial Kilo contributions are ready", async () => {
		const storageDir = mkdtempSync(path.join(tmpdir(), "anaconda-mcp-register-"));
		directories.push(storageDir);
		const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "anaconda-mcp",
			main: { storageDir },
		});
		const envContribute = vi.fn(() => () => {});
		const configurationSet = vi.fn(async () => {});

		const kiloSdk = createMainSdk("kilo-server");
		kiloSdk.plugins.expose("kiloService", {
			serverEnv: { contribute: envContribute },
			configuration: { set: configurationSet },
			restartServer: async () => {},
		});

		let releaseApiKey!: (apiKey: string) => void;
		const apiKey = new Promise<string>((resolve) => {
			releaseApiKey = resolve;
		});
		const authSdk = createMainSdk("auth");
		authSdk.plugins.expose("session", {
			getApiKey: () => apiKey,
			getSiteDomain: async () => "anaconda.com",
		});

		const featureFlagSdk = createMainSdk("feature-flag");
		featureFlagSdk.plugins.expose("featureFlag", {
			getFlag: <T>(_key: string, _defaultValue: T): T => true as T,
		});

		let registrationFinished = false;
		const registration = mainRegister(mainSdk).then(() => {
			registrationFinished = true;
		});

		await Promise.resolve();
		expect(registrationFinished).toBe(false);
		expect(envContribute).not.toHaveBeenCalled();
		expect(configurationSet).not.toHaveBeenCalled();

		releaseApiKey("test-api-key");
		await registration;

		expect(configurationSet).toHaveBeenCalledWith(CONTRIBUTION_SOURCE_ID, {
			mcpEntries: {
				"anaconda-remote": expect.objectContaining({ type: "remote" }),
			},
			plugins: {},
		});
		expect(envContribute).toHaveBeenCalledWith(CONTRIBUTION_SOURCE_ID, {
			[MCP_ENV_VAR]: "test-api-key",
		});
		mainSdk.dispose();
	});
});
