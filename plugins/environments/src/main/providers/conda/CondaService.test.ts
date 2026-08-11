import { describe, expect, it, vi } from "vitest";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import { parseEnvironmentsErrorMessage } from "../../../contracts/common.js";

import { CondaService, mapCondaError, parseEnvList } from "./CondaService.js";

const silentLogger: MainSdkLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

/**
 * Minimal shape mirroring the fields the service reads off `execa`. The
 * service structurally detects execa errors via `shortMessage` +
 * `command`, so tests can hand-roll matching objects without pulling in
 * execa's private class.
 */
type FakeExecaOk = { stdout: string };
type FakeExecaError = Error & {
	shortMessage: string;
	command: string;
	stderr?: string;
	isCanceled?: boolean;
};

function fakeExeca(result: FakeExecaOk | (() => FakeExecaOk | Promise<FakeExecaOk>)) {
	return vi.fn(async () => (typeof result === "function" ? await result() : result)) as unknown as (
		...args: unknown[]
	) => Promise<FakeExecaOk>;
}

function makeExecaError(overrides: Partial<FakeExecaError> = {}): FakeExecaError {
	const err = new Error(overrides.shortMessage ?? "Command failed") as FakeExecaError;
	err.shortMessage = overrides.shortMessage ?? "Command failed";
	err.command = overrides.command ?? "/tmp/conda env list --json";
	if (overrides.stderr !== undefined) err.stderr = overrides.stderr;
	if (overrides.isCanceled !== undefined) err.isCanceled = overrides.isCanceled;
	return err;
}

describe("parseEnvList", () => {
	it("names envs under an envs/ directory and leaves the base unnamed regardless of order", () => {
		// conda returns `envs` sorted alphabetically — the base prefix is
		// NOT guaranteed to come first.
		const envs = parseEnvList(
			JSON.stringify({
				envs: [
					"/opt/conda/envs/data-science",
					"/opt/conda",
					"/opt/conda/envs/ml",
					"/custom/location/path-env",
				],
			}),
		);
		expect(envs).toEqual([
			{ name: "data-science", prefix: "/opt/conda/envs/data-science" },
			{ name: "", prefix: "/opt/conda" },
			{ name: "ml", prefix: "/opt/conda/envs/ml" },
			{ name: "", prefix: "/custom/location/path-env" },
		]);
	});

	it("returns an empty list when conda reports no envs", () => {
		expect(parseEnvList(JSON.stringify({ envs: [] }))).toEqual([]);
	});

	it("throws PROVIDER_NOT_READY when stdout is not JSON", () => {
		try {
			parseEnvList("Traceback...");
			expect.fail("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(FeatureError);
			expect(parseEnvironmentsErrorMessage((error as FeatureError).message)?.code).toBe(
				"PROVIDER_NOT_READY",
			);
		}
	});

	it("throws PROVIDER_NOT_READY when the JSON is missing envs[]", () => {
		try {
			parseEnvList(JSON.stringify({ foo: "bar" }));
			expect.fail("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(FeatureError);
			expect(parseEnvironmentsErrorMessage((error as FeatureError).message)?.code).toBe(
				"PROVIDER_NOT_READY",
			);
		}
	});
});

describe("mapCondaError", () => {
	it("returns the original FeatureError untouched", () => {
		const original = new FeatureError("ENV_NOT_FOUND: missing", "NOT_FOUND");
		expect(mapCondaError(original)).toBe(original);
	});

	it("maps AbortSignal cancellations to JOB_CANCELLED", () => {
		const err = mapCondaError(makeExecaError({ isCanceled: true }));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("JOB_CANCELLED");
	});

	it("maps CondaEnvironmentNotFoundError stderr to ENV_NOT_FOUND", () => {
		const err = mapCondaError(
			makeExecaError({
				stderr: "CondaEnvironmentNotFoundError: Could not find environment: foo",
			}),
		);
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("ENV_NOT_FOUND");
	});

	it("maps PackagesNotFoundError stderr to PACKAGE_NOT_FOUND", () => {
		const err = mapCondaError(makeExecaError({ stderr: "PackagesNotFoundError: numpy" }));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("PACKAGE_NOT_FOUND");
	});

	it("maps UnsatisfiableError stderr to SOLVE_FAILED", () => {
		const err = mapCondaError(makeExecaError({ stderr: "UnsatisfiableError: conflict" }));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("SOLVE_FAILED");
	});

	it("maps InvalidMatchSpec stderr to INVALID_MATCHSPEC", () => {
		const err = mapCondaError(makeExecaError({ stderr: "InvalidMatchSpec: bogus spec" }));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("INVALID_MATCHSPEC");
	});

	it("maps ENOENT-style failures to PROVIDER_NOT_READY", () => {
		const err = mapCondaError(makeExecaError({ shortMessage: "spawn conda ENOENT" }));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("PROVIDER_NOT_READY");
	});

	it("maps unclassified execa failures to PROVIDER_NOT_READY", () => {
		const err = mapCondaError(makeExecaError({ shortMessage: "something else broke" }));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("PROVIDER_NOT_READY");
	});

	it("maps generic errors to PROVIDER_NOT_READY", () => {
		const err = mapCondaError(new Error("unexpected"));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("PROVIDER_NOT_READY");
	});

	it("maps SyntaxError (bad JSON) to PROVIDER_NOT_READY", () => {
		const err = mapCondaError(new SyntaxError("unexpected token"));
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("PROVIDER_NOT_READY");
	});
});

describe("CondaService.list", () => {
	it("invokes conda env list --json with plugin-scoped isolation env vars and returns parsed envs", async () => {
		const stdout = JSON.stringify({
			envs: ["/opt/conda", "/opt/conda/envs/dev"],
		});
		const execute = fakeExeca({ stdout });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/home/user/.anaconda-agentic-desktop/conda",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any -- execa mock uses a narrowed shape
			execute: execute as any,
		});

		const envs = await service.list();

		expect(envs).toEqual([
			{ name: "", prefix: "/opt/conda" },
			{ name: "dev", prefix: "/opt/conda/envs/dev" },
		]);
		expect(execute).toHaveBeenCalledTimes(1);
		const [bin, args, options] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(bin).toBe("/opt/conda/bin/conda");
		expect(args).toEqual(["env", "list", "--json"]);
		// Isolation must anchor at the plugin-scoped root — NOT the conda
		// binary's own install root, which for a system conda would be the
		// user's personal install.
		expect(options).toMatchObject({
			env: {
				CONDA_ENVS_PATH: "/home/user/.anaconda-agentic-desktop/conda/envs",
				CONDA_PKGS_DIRS: "/home/user/.anaconda-agentic-desktop/conda/pkgs",
				CONDARC: "/home/user/.anaconda-agentic-desktop/conda/.condarc",
			},
		});
	});

	it("forwards the AbortSignal to execa as cancelSignal (execa v9 option name)", async () => {
		const execute = fakeExeca({ stdout: JSON.stringify({ envs: [] }) });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		const controller = new AbortController();
		await service.list({ signal: controller.signal });

		const [, , options] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		// execa v9 renamed `signal` to `cancelSignal` — passing `signal`
		// makes execa throw a validation error instead of cancelling.
		expect((options as { cancelSignal?: AbortSignal }).cancelSignal).toBe(controller.signal);
		expect("signal" in (options as object)).toBe(false);
	});

	it("throws PROVIDER_NOT_READY when no condaBinPath was staged", async () => {
		const service = new CondaService({
			condaBinPath: "",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
		});
		await expect(service.list()).rejects.toBeInstanceOf(FeatureError);
	});

	it("translates execa failures via mapCondaError", async () => {
		const execute = vi.fn(async () => {
			throw makeExecaError({ stderr: "CondaEnvironmentNotFoundError: base" });
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});
		await expect(service.list()).rejects.toSatisfy((error) => {
			expect(error).toBeInstanceOf(FeatureError);
			return (
				parseEnvironmentsErrorMessage((error as FeatureError).message)?.code === "ENV_NOT_FOUND"
			);
		});
	});
});

describe("CondaService unimplemented ops", () => {
	function makeService(): CondaService {
		return new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
		});
	}

	it("rejects create with PROVIDER_NOT_READY", async () => {
		await expect(makeService().create({ name: "x" })).rejects.toBeInstanceOf(FeatureError);
	});

	it("rejects remove with PROVIDER_NOT_READY", async () => {
		await expect(makeService().remove({ name: "x" })).rejects.toBeInstanceOf(FeatureError);
	});

	it("rejects listPackages with PROVIDER_NOT_READY", async () => {
		await expect(makeService().listPackages("x")).rejects.toBeInstanceOf(FeatureError);
	});

	it("rejects install with PROVIDER_NOT_READY", async () => {
		await expect(makeService().install({ envName: "x", packages: ["y"] })).rejects.toBeInstanceOf(
			FeatureError,
		);
	});

	it("rejects uninstall with PROVIDER_NOT_READY", async () => {
		await expect(makeService().uninstall({ envName: "x", packages: ["y"] })).rejects.toBeInstanceOf(
			FeatureError,
		);
	});

	it("rejects listChannels with PROVIDER_NOT_READY", async () => {
		await expect(makeService().listChannels()).rejects.toBeInstanceOf(FeatureError);
	});

	it("rejects addChannel with PROVIDER_NOT_READY", async () => {
		await expect(makeService().addChannel("conda-forge")).rejects.toBeInstanceOf(FeatureError);
	});

	it("rejects removeChannel with PROVIDER_NOT_READY", async () => {
		await expect(makeService().removeChannel("conda-forge")).rejects.toBeInstanceOf(FeatureError);
	});
});
