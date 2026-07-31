import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Keyring } from "./keyring.js";
import { TokenPayloadParseError } from "../errors.js";
import type { AnacondaAuthSite } from "../config/config.js";

// Mock keytar so SystemKeyring doesn't try to load native module
const mockKeytar = {
	getPassword: vi.fn().mockResolvedValue(null),
	setPassword: vi.fn().mockResolvedValue(undefined),
	deletePassword: vi.fn().mockResolvedValue(true),
	findCredentials: vi.fn(),
	findPassword: vi.fn(),
};
vi.mock("@github/keytar", () => ({
	default: mockKeytar,
	...mockKeytar,
}));

function createSite(overrides: Partial<AnacondaAuthSite> = {}): AnacondaAuthSite {
	return {
		domain: "anaconda.com",
		preferred_token_storage: "anaconda-keyring",
		...overrides,
	};
}

describe("Keyring", () => {
	let tmpDir: string;
	let keyringPath: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "keyring-orch-test-"));
		keyringPath = join(tmpDir, "keyring");
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("getToken returns null when no backends have a token", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));

		const result = await keyring.getToken();

		expect(result).toBeNull();
	});

	it("saveToken persists and getToken retrieves", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));

		await keyring.saveToken({ api_key: "ak-orch-123", username: "bob" });
		const result = await keyring.getToken();

		expect(result?.api_key).toBe("ak-orch-123");
		expect(result?.username).toBe("bob");
		expect(result?.domain).toBe("anaconda.com");
		expect(result?.version).toBe(2);
	});

	it("getApiKey returns api_key from token", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));
		await keyring.saveToken({ api_key: "ak-api-456" });

		const apiKey = await keyring.getApiKey();

		expect(apiKey).toBe("ak-api-456");
	});

	it("getUserId returns user_id from token", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));
		await keyring.saveToken({ api_key: "ak-x", user_id: "uid-789" });

		const userId = await keyring.getUserId();

		expect(userId).toBe("uid-789");
	});

	it("getToken prefers higher-priority backend", async () => {
		// First, save a token to the file backend
		const fileKeyring = await Keyring.load(createSite({ keyring_path: keyringPath }));
		await fileKeyring.saveToken({ api_key: "ak-file-lower" });

		// Now create a keyring where ConfigKeyring has priority 100 (api_key set)
		const keyring = await Keyring.load(
			createSite({ keyring_path: keyringPath, api_key: "ak-config-priority" }),
		);

		const result = await keyring.getToken();

		// Config backend (priority 100) wins over anaconda-keyring (priority 11)
		expect(result?.api_key).toBe("ak-config-priority");
	});

	it("writable is true when primary backend is writable", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));
		expect(keyring.writable).toBe(true);
	});

	it("writable is false when config backend is primary", async () => {
		const keyring = await Keyring.load(
			createSite({ keyring_path: keyringPath, api_key: "ak-config" }),
		);
		expect(keyring.writable).toBe(false);
	});

	it("saveToken writes to primary backend only", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));

		await keyring.saveToken({ api_key: "ak-save-test" });
		const result = await keyring.getToken();

		expect(result?.api_key).toBe("ak-save-test");
	});

	it("deleteToken removes from primary backend", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));
		await keyring.saveToken({ api_key: "ak-to-delete" });

		await keyring.deleteToken();
		const result = await keyring.getToken();

		expect(result).toBeNull();
	});

	it("getToken falls through to next backend when first returns null", async () => {
		const keyring = await Keyring.load(createSite({ keyring_path: keyringPath }));

		// Nothing saved — all backends return null
		const result = await keyring.getToken();
		expect(result).toBeNull();

		// Now save — should be found
		await keyring.saveToken({ api_key: "ak-found" });
		const found = await keyring.getToken();
		expect(found?.api_key).toBe("ak-found");
	});

	it("getToken falls through when a backend throws a SystemKeyringError", async () => {
		// preferred "system" makes SystemKeyring the primary (priority 11) and keeps
		// AnacondaKeyring (priority 0.2) as a fallback in the backend list.
		const site = createSite({ keyring_path: keyringPath, preferred_token_storage: "system" });

		// Seed the anaconda-keyring file backend with a token.
		const fileKeyring = await Keyring.load(
			createSite({ keyring_path: keyringPath, preferred_token_storage: "anaconda-keyring" }),
		);
		await fileKeyring.saveToken({ api_key: "ak-fallback" });

		// System keyring is unavailable.
		mockKeytar.getPassword.mockRejectedValueOnce(new Error("keychain unavailable"));

		const keyring = await Keyring.load(site);
		const result = await keyring.getToken();

		expect(result?.api_key).toBe("ak-fallback");
	});

	it("getToken propagates a decode error from a corrupt entry in the primary backend", async () => {
		const keyring = await Keyring.load(
			createSite({ keyring_path: keyringPath, preferred_token_storage: "system" }),
		);

		mockKeytar.getPassword.mockResolvedValueOnce("not-a-valid-token");

		await expect(keyring.getToken()).rejects.toThrow(TokenPayloadParseError);
	});
});
