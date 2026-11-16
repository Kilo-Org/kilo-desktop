import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { AnacondaConfig, anacondaConfigSchema } from "./config";

function createTempConfig(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "anaconda-config-test-"));
	const filePath = join(dir, "config.toml");
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

describe("AnacondaConfig", () => {
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalEnv = process.env.ANACONDA_CONFIG_TOML;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		if (originalEnv === undefined) {
			delete process.env.ANACONDA_CONFIG_TOML;
		} else {
			process.env.ANACONDA_CONFIG_TOML = originalEnv;
		}
	});

	describe("path resolution", () => {
		// The default path is under a temporary home: loading creates a missing config.
		beforeEach(() => {
			vi.stubEnv("HOME", mkdtempSync(join(tmpdir(), "anaconda-home-")));
			vi.stubEnv("USERPROFILE", process.env.HOME);
		});

		it("defaults to ~/.anaconda/config.toml", async () => {
			delete process.env.ANACONDA_CONFIG_TOML;
			const config = await AnacondaConfig.load();
			expect(config.path).toBe(join(homedir(), ".anaconda", "config.toml"));
		});

		it("respects ANACONDA_CONFIG_TOML env var", async () => {
			const filePath = createTempConfig("");
			process.env.ANACONDA_CONFIG_TOML = filePath;

			const config = await AnacondaConfig.load();
			expect(config.path).toBe(filePath);
		});

		it("ignores empty ANACONDA_CONFIG_TOML env var", async () => {
			process.env.ANACONDA_CONFIG_TOML = "";
			const config = await AnacondaConfig.load();
			expect(config.path).toBe(join(homedir(), ".anaconda", "config.toml"));
		});
	});

	it("reads a valid TOML config file", async () => {
		const filePath = createTempConfig(`
default_site = "anaconda.com"

[plugin.auth]
domain = "anaconda.com"
ssl_verify = true
client_id = "00000000-0000-4000-8000-000000000001"

[sites.local]
domain = "localhost"
ssl_verify = false
`);
		process.env.ANACONDA_CONFIG_TOML = filePath;

		const config = await AnacondaConfig.load();

		expect(config.store.default_site).toBe("anaconda.com");
		expect(config.store.plugin?.auth?.domain).toBe("anaconda.com");
		expect(config.store.plugin?.auth?.ssl_verify).toBe(true);
		expect(config.store.sites?.local?.domain).toBe("localhost");
		expect(config.path).toBe(filePath);
	});

	it("creates config file if it does not exist", async () => {
		const dir = mkdtempSync(join(tmpdir(), "anaconda-config-test-"));
		const filePath = join(dir, ".anaconda", "config.toml");
		process.env.ANACONDA_CONFIG_TOML = filePath;

		const config = await AnacondaConfig.load();

		expect(config.store).toEqual({});
		expect(existsSync(filePath)).toBe(true);
	});

	it("has() checks top-level key existence", async () => {
		const filePath = createTempConfig(`
default_site = "anaconda.com"

[plugin.auth]
domain = "example.com"
`);
		process.env.ANACONDA_CONFIG_TOML = filePath;

		const config = await AnacondaConfig.load();

		expect(config.has("default_site")).toBe(true);
		expect(config.has("plugin")).toBe(true);
		expect(config.has("nonexistent")).toBe(false);
	});

	it("throws ConfigParseError for malformed TOML", async () => {
		const filePath = createTempConfig("this is [not valid toml = ");
		process.env.ANACONDA_CONFIG_TOML = filePath;

		await expect(AnacondaConfig.load()).rejects.toThrow("Failed to parse TOML");
	});

	it("throws ConfigValidationError for well-formed TOML with invalid values", async () => {
		const filePath = createTempConfig("default_site = 42");
		process.env.ANACONDA_CONFIG_TOML = filePath;

		await expect(AnacondaConfig.load()).rejects.toThrow("Config validation failed");
	});

	it("preserves unknown fields (passthrough)", async () => {
		const filePath = createTempConfig(`
default_site = "anaconda.com"

[plugin.auth]
domain = "anaconda.com"
future_setting = "hello"

[plugin.conda]
channels = ["defaults"]
`);
		process.env.ANACONDA_CONFIG_TOML = filePath;

		const config = await AnacondaConfig.load();
		const store = config.store as Record<string, unknown>;
		const plugin = store.plugin as Record<string, unknown>;

		expect((plugin.auth as Record<string, unknown>).future_setting).toBe("hello");
		expect(plugin.conda).toEqual({ channels: ["defaults"] });
	});

	it("handles ssl_verify as string (cert path)", async () => {
		const filePath = createTempConfig(`
[plugin.auth]
ssl_verify = "/path/to/cert.pem"
`);
		process.env.ANACONDA_CONFIG_TOML = filePath;

		const config = await AnacondaConfig.load();
		expect(config.store.plugin?.auth?.ssl_verify).toBe("/path/to/cert.pem");
	});

	describe("get() with defaults", () => {
		it("returns default when key is not in the file", async () => {
			const dir = mkdtempSync(join(tmpdir(), "anaconda-config-test-"));
			process.env.ANACONDA_CONFIG_TOML = join(dir, "config.toml");

			const config = await AnacondaConfig.load({
				defaults: { default_site: "anaconda.com" },
			});

			expect(config.get("default_site")).toBe("anaconda.com");
		});

		it("returns file value over default", async () => {
			const filePath = createTempConfig(`
default_site = "custom.com"
`);
			process.env.ANACONDA_CONFIG_TOML = filePath;

			const config = await AnacondaConfig.load({
				defaults: { default_site: "anaconda.com" },
			});

			expect(config.get("default_site")).toBe("custom.com");
		});

		it("returns undefined when no default and key missing", async () => {
			const dir = mkdtempSync(join(tmpdir(), "anaconda-config-test-"));
			process.env.ANACONDA_CONFIG_TOML = join(dir, "config.toml");

			const config = await AnacondaConfig.load();
			expect(config.get("default_site")).toBeUndefined();
		});

		it("store remains the raw file data (no defaults merged)", async () => {
			const dir = mkdtempSync(join(tmpdir(), "anaconda-config-test-"));
			process.env.ANACONDA_CONFIG_TOML = join(dir, "config.toml");

			const config = await AnacondaConfig.load({
				defaults: { default_site: "anaconda.com" },
			});

			expect(config.store).toEqual({});
			expect(config.get("default_site")).toBe("anaconda.com");
		});

		it("works with no options", async () => {
			const filePath = createTempConfig(`
default_site = "test.com"
`);
			process.env.ANACONDA_CONFIG_TOML = filePath;

			const config = await AnacondaConfig.load();
			expect(config.get("default_site")).toBe("test.com");
		});
	});

	describe("schema", () => {
		it("validates a full config", () => {
			const input = {
				default_site: "anaconda.com",
				plugin: {
					auth: {
						domain: "anaconda.com",
						ssl_verify: true,
						client_id: "00000000-0000-4000-8000-000000000001",
						api_key: "secret-key",
						keyring_path: "~/.anaconda/keyring",
						redirect_uri: "http://127.0.0.1:8000/auth/oidc",
					},
				},
				sites: {
					local: {
						domain: "localhost",
						ssl_verify: false,
						auth_domain_override: "auth-local",
					},
				},
			};

			const result = anacondaConfigSchema.safeParse(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.default_site).toBe("anaconda.com");
				expect(result.data.plugin?.auth?.domain).toBe("anaconda.com");
				expect(result.data.sites?.local?.domain).toBe("localhost");
			}
		});

		it("validates an empty config", () => {
			const result = anacondaConfigSchema.safeParse({});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual({});
			}
		});

		it("passes through unknown top-level fields", () => {
			const input = {
				default_site: "anaconda.com",
				some_other_tool: { enabled: true },
			};

			const result = anacondaConfigSchema.safeParse(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect((result.data as Record<string, unknown>).some_other_tool).toEqual({
					enabled: true,
				});
			}
		});

		it("passes through unknown fields inside plugin.auth", () => {
			const input = {
				plugin: {
					auth: {
						domain: "anaconda.com",
						future_field: "some-value",
					},
				},
			};

			const result = anacondaConfigSchema.safeParse(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect((result.data.plugin?.auth as Record<string, unknown>)?.future_field).toBe(
					"some-value",
				);
			}
		});

		it("passes through unknown plugin sections", () => {
			const input = {
				plugin: {
					auth: { domain: "anaconda.com" },
					some_other_plugin: { key: "value" },
				},
			};

			const result = anacondaConfigSchema.safeParse(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect((result.data.plugin as Record<string, unknown>)?.some_other_plugin).toEqual({
					key: "value",
				});
			}
		});

		it("rejects non-object input", () => {
			expect(anacondaConfigSchema.safeParse("string").success).toBe(false);
			expect(anacondaConfigSchema.safeParse(42).success).toBe(false);
			expect(anacondaConfigSchema.safeParse(null).success).toBe(false);
		});
	});
});
