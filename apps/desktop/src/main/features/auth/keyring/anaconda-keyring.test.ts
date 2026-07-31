import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, open, writeFile as nodeWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { writeFile } from "atomically";
import type * as FsPromises from "node:fs/promises";
import { AnacondaKeyring } from "./anaconda-keyring.js";
import { AnacondaKeyringWriteError } from "../errors.js";
import type { AnacondaAuthSite } from "../config/config.js";
import type { TokenPayload } from "../types.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof FsPromises>();
	return { ...actual, open: vi.fn(actual.open) };
});

// Keep unit tests independent of atomically's platform-specific locking and retries.
vi.mock("atomically", async () => {
	const { writeFile } = await import("node:fs/promises");
	return { writeFile: vi.fn(writeFile) };
});

function createSite(
	keyringPath: string,
	preferred?: "system" | "anaconda-keyring",
): AnacondaAuthSite {
	return {
		keyring_path: keyringPath,
		preferred_token_storage: preferred ?? "anaconda-keyring",
	};
}

const testPayload: TokenPayload = {
	domain: "anaconda.com",
	api_key: "ak-test-123",
	username: "testuser",
	repo_tokens: [{ token: "rt-1", org_name: "myorg" }],
	version: 2,
};

describe("AnacondaKeyring", () => {
	let tmpDir: string;
	let keyringPath: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "keyring-test-"));
		keyringPath = join(tmpDir, "keyring");
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("getToken returns null when keyring file does not exist", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));

		const result = await backend.getToken("anaconda.com");

		expect(result).toBeNull();
	});

	it("getToken returns null when the keyring file is corrupt JSON", async () => {
		await nodeWriteFile(keyringPath, "{ not valid json", "utf-8");
		const backend = new AnacondaKeyring(createSite(keyringPath));

		const result = await backend.getToken("anaconda.com");

		expect(result).toBeNull();
	});

	it("saveToken creates the keyring file and persists token", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));

		await backend.saveToken("anaconda.com", testPayload);

		const content = await readFile(keyringPath, "utf-8");
		const file = JSON.parse(content);
		expect(file["Anaconda Cloud"]).toBeDefined();
		expect(file["Anaconda Cloud"]["anaconda.com"]).toBeTypeOf("string");
	});

	it("getToken returns saved token for a domain", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));

		await backend.saveToken("anaconda.com", testPayload);
		const result = await backend.getToken("anaconda.com");

		expect(result).toEqual(testPayload);
	});

	it("saveToken overwrites existing token for same domain", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));
		await backend.saveToken("anaconda.com", testPayload);

		const updated: TokenPayload = { ...testPayload, api_key: "ak-new-456" };
		await backend.saveToken("anaconda.com", updated);

		const result = await backend.getToken("anaconda.com");
		expect(result?.api_key).toBe("ak-new-456");
	});

	it("deleteToken removes token for a domain", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));
		// Save two domains so the file isn't deleted
		await backend.saveToken("anaconda.com", testPayload);
		await backend.saveToken("other.com", { ...testPayload, domain: "other.com" });

		await backend.deleteToken("anaconda.com");

		const result = await backend.getToken("anaconda.com");
		expect(result).toBeNull();
		// other domain still exists
		const other = await backend.getToken("other.com");
		expect(other?.domain).toBe("other.com");
	});

	it("deleteToken removes keyring file when last entry is deleted", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));
		await backend.saveToken("anaconda.com", testPayload);

		await backend.deleteToken("anaconda.com");

		// File should be gone — getToken should return null
		const result = await backend.getToken("anaconda.com");
		expect(result).toBeNull();
		// Verify file doesn't exist
		await expect(readFile(keyringPath, "utf-8")).rejects.toThrow();
	});

	it("deleteToken is a no-op when domain does not exist", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));

		// Should not throw
		await backend.deleteToken("nonexistent.com");
	});

	it("priority is 11 when preferred_token_storage is anaconda-keyring", () => {
		const backend = new AnacondaKeyring(createSite(keyringPath, "anaconda-keyring"));
		expect(backend.priority).toBe(11);
	});

	it("priority is 0.2 when preferred_token_storage is system", () => {
		const backend = new AnacondaKeyring(createSite(keyringPath, "system"));
		expect(backend.priority).toBe(0.2);
	});

	it("isViable returns true when keyring path is writable", async () => {
		const backend = new AnacondaKeyring(createSite(keyringPath));

		const viable = await backend.isViable();

		expect(viable).toBe(true);
	});

	it("isViable returns false when keyring path is not writable", async () => {
		vi.mocked(open).mockRejectedValueOnce(new Error("EACCES"));
		const backend = new AnacondaKeyring(createSite(keyringPath));

		const viable = await backend.isViable();

		expect(viable).toBe(false);
	});

	it("saveToken throws AnacondaKeyringWriteError on write failure", async () => {
		vi.mocked(writeFile).mockRejectedValueOnce(new Error("EACCES"));
		const backend = new AnacondaKeyring(createSite(keyringPath));

		await expect(backend.saveToken("anaconda.com", testPayload)).rejects.toThrow(
			AnacondaKeyringWriteError,
		);
	});

	describe("path resolution", () => {
		it("expands ~ to the home directory", () => {
			const backend = new AnacondaKeyring(createSite("~"));

			expect(backend.path).toBe(homedir());
		});

		it("expands the default keyring path under the home directory", () => {
			const backend = new AnacondaKeyring({ preferred_token_storage: "anaconda-keyring" });

			expect(backend.path).toBe(join(homedir(), ".anaconda", "keyring"));
		});

		it("expands a leading ~ in keyring_path under the home directory", () => {
			const backend = new AnacondaKeyring(createSite("~/custom/keyring"));

			expect(backend.path).toBe(join(homedir(), "custom", "keyring"));
		});

		it("leaves an absolute keyring_path unchanged", () => {
			const absolute = join(tmpdir(), "explicit", "keyring");
			const backend = new AnacondaKeyring(createSite(absolute));

			expect(backend.path).toBe(absolute);
		});

		it("only expands a leading ~, not a ~ elsewhere in the path", () => {
			const backend = new AnacondaKeyring(createSite("/opt/~backup/keyring"));

			expect(backend.path).toBe("/opt/~backup/keyring");
		});
	});
});
