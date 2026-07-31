import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemKeyring } from "./system-keyring.js";
import {
	SystemKeyringError,
	TokenPayloadParseError,
	TokenPayloadValidationError,
} from "../errors.js";
import { encodeToken } from "./codec.js";
import type { AnacondaAuthSite } from "../config/config.js";
import type { TokenPayload } from "../types.js";

const mockKeytar = {
	getPassword: vi.fn(),
	setPassword: vi.fn(),
	deletePassword: vi.fn(),
	findCredentials: vi.fn(),
	findPassword: vi.fn(),
};

vi.mock("@github/keytar", () => ({
	default: mockKeytar,
	...mockKeytar,
}));

function createSite(preferred?: "system" | "anaconda-keyring"): AnacondaAuthSite {
	return {
		preferred_token_storage: preferred ?? "system",
	};
}

const testPayload: TokenPayload = {
	domain: "anaconda.com",
	api_key: "ak-sys-123",
	username: "sysuser",
	version: 2,
};

describe("SystemKeyring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("getToken returns decoded token from system keychain", async () => {
		const backend = new SystemKeyring(createSite("system"));
		mockKeytar.getPassword.mockResolvedValue(encodeToken(testPayload));

		const result = await backend.getToken("anaconda.com");

		expect(result).toEqual(testPayload);
		expect(mockKeytar.getPassword).toHaveBeenCalledWith("Anaconda Cloud", "anaconda.com");
	});

	it("getToken returns null when no password stored", async () => {
		const backend = new SystemKeyring(createSite("system"));
		mockKeytar.getPassword.mockResolvedValue(null);

		const result = await backend.getToken("anaconda.com");

		expect(result).toBeNull();
	});

	it("saveToken stores encoded token in system keychain", async () => {
		const backend = new SystemKeyring(createSite("system"));
		mockKeytar.setPassword.mockResolvedValue(undefined);

		await backend.saveToken("anaconda.com", testPayload);

		expect(mockKeytar.setPassword).toHaveBeenCalledWith(
			"Anaconda Cloud",
			"anaconda.com",
			expect.any(String),
		);
		// Verify the stored value is valid encoded token
		const storedValue = mockKeytar.setPassword.mock.calls[0]![2] as string;
		const decoded = JSON.parse(Buffer.from(storedValue, "base64").toString("utf-8"));
		expect(decoded.api_key).toBe("ak-sys-123");
	});

	it("deleteToken removes credential from system keychain", async () => {
		const backend = new SystemKeyring(createSite("system"));
		mockKeytar.deletePassword.mockResolvedValue(true);

		await backend.deleteToken("anaconda.com");

		expect(mockKeytar.deletePassword).toHaveBeenCalledWith("Anaconda Cloud", "anaconda.com");
	});

	it("getToken throws SystemKeyringError when keytar fails", async () => {
		const backend = new SystemKeyring(createSite("system"));
		mockKeytar.getPassword.mockRejectedValue(new Error("D-Bus unavailable"));

		await expect(backend.getToken("anaconda.com")).rejects.toThrow(SystemKeyringError);
	});

	it("getToken throws TokenPayloadParseError when stored value is not valid base64 JSON", async () => {
		const backend = new SystemKeyring(createSite("system"));
		mockKeytar.getPassword.mockResolvedValue("not-a-valid-token");

		await expect(backend.getToken("anaconda.com")).rejects.toThrow(TokenPayloadParseError);
	});

	it("getToken throws TokenPayloadValidationError when stored token fails schema validation", async () => {
		const backend = new SystemKeyring(createSite("system"));
		const invalid = Buffer.from(JSON.stringify({ not: "a token" })).toString("base64");
		mockKeytar.getPassword.mockResolvedValue(invalid);

		await expect(backend.getToken("anaconda.com")).rejects.toThrow(TokenPayloadValidationError);
	});

	it("priority is 11 when preferred_token_storage is system", () => {
		const backend = new SystemKeyring(createSite("system"));
		expect(backend.priority).toBe(11);
	});

	it("priority is 0 when preferred_token_storage is anaconda-keyring and anaconda is viable", () => {
		const backend = new SystemKeyring(createSite("anaconda-keyring"), true);
		expect(backend.priority).toBe(0);
	});

	it("priority is 5 as fallback when anaconda is not viable", () => {
		const backend = new SystemKeyring(createSite("anaconda-keyring"), false);
		expect(backend.priority).toBe(5);
	});
});
