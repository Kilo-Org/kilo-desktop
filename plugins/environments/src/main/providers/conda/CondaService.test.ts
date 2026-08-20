import { Readable } from "node:stream";
import path from "node:path";

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
	// Return an execa-shaped subprocess: an awaitable Promise that also
	// exposes `.stdout` / `.stderr` streams. `#runCondaStreaming` reads the
	// streams synchronously off the subprocess, so the fake has to expose
	// them alongside the eventual resolved value (real execa's
	// `ResultPromise` shape). Streams default to `null`; individual tests
	// can override via `fakeExecaStreaming(...)`.
	return vi.fn((..._args: unknown[]) => {
		const settled = Promise.resolve(
			typeof result === "function" ? result() : result,
		) as Promise<FakeExecaOk> & {
			stdout: NodeJS.ReadableStream | null;
			stderr: NodeJS.ReadableStream | null;
		};
		settled.stdout = null;
		settled.stderr = null;
		return settled;
	}) as unknown as (...args: unknown[]) => Promise<FakeExecaOk>;
}

/**
 * Variant of {@link fakeExeca} that attaches Node Readable streams for
 * stdout / stderr, so tests of the streaming write path can drive
 * `ctx.onProgress` deterministically. Pass `error` to make the
 * subprocess promise reject after the streams have been produced —
 * mirroring a real non-zero exit under `buffer: false`, where the
 * thrown ExecaError carries NO `stderr` of its own.
 */
function fakeExecaStreaming({
	stdout,
	stderr,
	result = { stdout: "" },
	error,
}: {
	stdout?: readonly string[];
	stderr?: readonly string[];
	result?: FakeExecaOk;
	error?: FakeExecaError;
}) {
	return vi.fn((..._args: unknown[]) => {
		const stdoutStream = stdout ? Readable.from(stdout.map((line) => `${line}\n`)) : null;
		const stderrStream = stderr ? Readable.from(stderr.map((line) => `${line}\n`)) : null;
		const settled = (
			error ? Promise.reject(error) : Promise.resolve(result)
		) as Promise<FakeExecaOk> & {
			stdout: NodeJS.ReadableStream | null;
			stderr: NodeJS.ReadableStream | null;
		};
		// Pre-attach a catch so the pending rejection does not trip the
		// unhandled-rejection detector before the service awaits it.
		if (error) settled.catch(() => {});
		settled.stdout = stdoutStream;
		settled.stderr = stderrStream;
		return settled;
	}) as unknown as (...args: unknown[]) => Promise<FakeExecaOk>;
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

	it("maps 'prefix already exists' stderr to ENV_EXISTS", () => {
		const err = mapCondaError(
			makeExecaError({
				stderr: "CondaValueError: prefix already exists: /tmp/conda/envs/dev",
			}),
		);
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("ENV_EXISTS");
	});

	it("maps 'prefix already exists' without a CondaValueError wrapper to ENV_EXISTS", () => {
		const err = mapCondaError(
			makeExecaError({
				stderr: "CondaError: prefix already exists: /tmp/conda/envs/dev",
			}),
		);
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("ENV_EXISTS");
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

	it("classifies conda-anaconda-tos rejections with an actionable ToS message", () => {
		const err = mapCondaError(
			makeExecaError({
				stderr:
					"CondaToSNonInteractiveError: Terms of Service have not been accepted for the following channels: https://repo.anaconda.com/pkgs/main",
			}),
		);
		const parsed = parseEnvironmentsErrorMessage(err.message);
		expect(parsed?.code).toBe("PROVIDER_NOT_READY");
		expect(parsed?.detail).toMatch(/Terms of Service/i);
	});

	it("uses fallbackStderr for classification when the error carries no stderr (buffer: false)", () => {
		// Under `buffer: false` execa attaches NO stderr to the error — the
		// streaming path collects it out-of-band and passes it here.
		const err = mapCondaError(
			makeExecaError({ shortMessage: "Command failed with exit code 1" }),
			undefined,
			"CondaValueError: prefix already exists: /tmp/envs/dev",
		);
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("ENV_EXISTS");
	});

	it("prefers the error's own stderr over fallbackStderr when both exist", () => {
		const err = mapCondaError(
			makeExecaError({ stderr: "PackagesNotFoundError: numpy" }),
			undefined,
			"CondaValueError: prefix already exists: /tmp/envs/dev",
		);
		expect(parseEnvironmentsErrorMessage(err.message)?.code).toBe("PACKAGE_NOT_FOUND");
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
		// user's personal install. Expected paths are built with path.join
		// so the assertion holds on Windows (backslash separators) too.
		const root = "/home/user/.anaconda-agentic-desktop/conda";
		expect(options).toMatchObject({
			env: {
				CONDA_ENVS_PATH: path.join(root, "envs"),
				CONDA_PKGS_DIRS: path.join(root, "pkgs"),
				CONDARC: path.join(root, ".condarc"),
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

describe("CondaService.create", () => {
	it("invokes `conda create -n <name> --yes` with isolation env vars (no --json for writes) and returns the created env", async () => {
		const execute = fakeExeca({ stdout: "" });
		const root = "/home/user/.anaconda-agentic-desktop/conda";
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: root,
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any -- execa mock uses a narrowed shape
			execute: execute as any,
		});

		const env = await service.create({ name: "dev" });

		expect(env).toEqual({
			name: "dev",
			prefix: path.join(root, "envs", "dev"),
		});
		expect(execute).toHaveBeenCalledTimes(1);
		const [bin, args, options] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(bin).toBe("/opt/conda/bin/conda");
		// Deliberately no `--json` — we forward conda's own stdout progress
		// lines to the banner instead of buffering a structured stream we
		// don't consume, and rely on stderr for error classification.
		expect(args).toEqual(["create", "--name", "dev", "--yes"]);
		expect(options).toMatchObject({
			env: {
				CONDA_ENVS_PATH: path.join(root, "envs"),
				CONDA_PKGS_DIRS: path.join(root, "pkgs"),
				CONDARC: path.join(root, ".condarc"),
				// conda >= 25.7 gates default channels behind a ToS plugin;
				// the plugin-scoped isolation discards the user's own
				// acceptance, so writes must auto-accept or every create
				// dies with CondaToSNonInteractiveError.
				CONDA_PLUGINS_AUTO_ACCEPT_TOS: "yes",
			},
			// `buffer: false` keeps stdout out of memory while the process
			// runs — critical for a create that pulls hundreds of MB.
			buffer: false,
		});
	});

	it("classifies a streaming failure from the collected stderr tail (execa attaches none under buffer: false)", async () => {
		const execute = fakeExecaStreaming({
			stderr: ["CondaValueError: prefix already exists: /tmp/conda-root/envs/dev"],
			error: makeExecaError({ shortMessage: "Command failed with exit code 1" }),
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		await expect(service.create({ name: "dev" })).rejects.toSatisfy((error) => {
			expect(error).toBeInstanceOf(FeatureError);
			return parseEnvironmentsErrorMessage((error as FeatureError).message)?.code === "ENV_EXISTS";
		});
	});

	it("appends channels then a -- sentinel before positional packages so a stray -flag cannot smuggle a conda CLI arg", async () => {
		const execute = fakeExeca({ stdout: "" });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		await service.create({
			name: "ml",
			channels: ["conda-forge", "pytorch"],
			packages: ["numpy>=1.24", "pandas=2.*"],
		});

		const [, args] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(args).toEqual([
			"create",
			"--name",
			"ml",
			"--yes",
			"--channel",
			"conda-forge",
			"--channel",
			"pytorch",
			// End-of-options sentinel — argv after this is positional even
			// if a matchspec begins with `-` (the schema also rejects that,
			// but the sentinel keeps the guarantee at the argv boundary).
			"--",
			"numpy>=1.24",
			"pandas=2.*",
		]);
	});

	it("omits the -- sentinel when there are no packages (avoids a dangling bare `--`)", async () => {
		const execute = fakeExeca({ stdout: "" });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		await service.create({ name: "dev", channels: ["conda-forge"] });

		const [, args] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(args).not.toContain("--");
		expect(args).toEqual(["create", "--name", "dev", "--yes", "--channel", "conda-forge"]);
	});

	it("streams conda stdout lines through ctx.onProgress so the banner reflects each phase in real time", async () => {
		const execute = fakeExecaStreaming({
			stdout: ["Collecting package metadata", "Solving environment", "Preparing transaction"],
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		const progress: string[] = [];
		await service.create({ name: "dev" }, { onProgress: (msg) => progress.push(msg) });

		// Before + streamed conda lines + after.
		expect(progress[0]).toMatch(/creating environment "dev"/i);
		expect(progress).toContain("Collecting package metadata");
		expect(progress).toContain("Solving environment");
		expect(progress).toContain("Preparing transaction");
		expect(progress.at(-1)).toMatch(/environment "dev" created/i);
	});

	it("forwards the AbortSignal to execa as cancelSignal (execa v9 option name)", async () => {
		const execute = fakeExeca({ stdout: "" });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		const controller = new AbortController();
		await service.create({ name: "dev" }, { signal: controller.signal });

		const [, , options] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect((options as { cancelSignal?: AbortSignal }).cancelSignal).toBe(controller.signal);
		expect("signal" in (options as object)).toBe(false);
	});

	it("throws PROVIDER_NOT_READY when no condaBinPath was staged", async () => {
		const service = new CondaService({
			condaBinPath: "",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
		});
		await expect(service.create({ name: "dev" })).rejects.toBeInstanceOf(FeatureError);
	});

	it("translates 'prefix already exists' to ENV_EXISTS", async () => {
		const execute = vi.fn(async () => {
			throw makeExecaError({
				stderr: "CondaValueError: prefix already exists: /tmp/conda-root/envs/dev",
			});
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});
		await expect(service.create({ name: "dev" })).rejects.toSatisfy((error) => {
			expect(error).toBeInstanceOf(FeatureError);
			return parseEnvironmentsErrorMessage((error as FeatureError).message)?.code === "ENV_EXISTS";
		});
	});

	it("translates PackagesNotFoundError to PACKAGE_NOT_FOUND", async () => {
		const execute = vi.fn(async () => {
			throw makeExecaError({ stderr: "PackagesNotFoundError: nosuchpkg" });
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});
		await expect(service.create({ name: "dev", packages: ["nosuchpkg"] })).rejects.toSatisfy(
			(error) => {
				expect(error).toBeInstanceOf(FeatureError);
				return (
					parseEnvironmentsErrorMessage((error as FeatureError).message)?.code ===
					"PACKAGE_NOT_FOUND"
				);
			},
		);
	});

	it("translates UnsatisfiableError to SOLVE_FAILED", async () => {
		const execute = vi.fn(async () => {
			throw makeExecaError({ stderr: "UnsatisfiableError: conflict" });
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});
		await expect(
			service.create({ name: "dev", packages: ["python=2", "python=3"] }),
		).rejects.toSatisfy((error) => {
			expect(error).toBeInstanceOf(FeatureError);
			return (
				parseEnvironmentsErrorMessage((error as FeatureError).message)?.code === "SOLVE_FAILED"
			);
		});
	});
});

describe("CondaService.remove", () => {
	it("invokes `conda env remove -n <name> --yes` with isolation env vars (no --json for writes)", async () => {
		const execute = fakeExeca({ stdout: "" });
		const root = "/home/user/.anaconda-agentic-desktop/conda";
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: root,
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		await service.remove({ name: "dev" });

		const [bin, args, options] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(bin).toBe("/opt/conda/bin/conda");
		expect(args).toEqual(["env", "remove", "--name", "dev", "--yes"]);
		expect(options).toMatchObject({
			env: {
				CONDA_ENVS_PATH: path.join(root, "envs"),
				CONDA_PKGS_DIRS: path.join(root, "pkgs"),
				CONDARC: path.join(root, ".condarc"),
			},
			buffer: false,
		});
	});

	it("forwards onProgress messages before and after the subprocess call", async () => {
		const execute = fakeExeca({ stdout: "" });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		const progress: string[] = [];
		await service.remove({ name: "dev" }, { onProgress: (msg) => progress.push(msg) });

		expect(progress[0]).toMatch(/removing environment "dev"/i);
		expect(progress.at(-1)).toMatch(/environment "dev" removed/i);
	});

	it("streams conda stderr lines through ctx.onProgress (conda emits removal progress there)", async () => {
		const execute = fakeExecaStreaming({
			stderr: ["Remove packages", "Deleting prefix"],
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		const progress: string[] = [];
		await service.remove({ name: "dev" }, { onProgress: (msg) => progress.push(msg) });

		expect(progress).toContain("Remove packages");
		expect(progress).toContain("Deleting prefix");
	});

	it("forwards the AbortSignal to execa as cancelSignal", async () => {
		const execute = fakeExeca({ stdout: "" });
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});

		const controller = new AbortController();
		await service.remove({ name: "dev" }, { signal: controller.signal });

		const [, , options] = (execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect((options as { cancelSignal?: AbortSignal }).cancelSignal).toBe(controller.signal);
	});

	it("throws PROVIDER_NOT_READY when no condaBinPath was staged", async () => {
		const service = new CondaService({
			condaBinPath: "",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
		});
		await expect(service.remove({ name: "dev" })).rejects.toBeInstanceOf(FeatureError);
	});

	it("translates CondaEnvironmentNotFoundError to ENV_NOT_FOUND", async () => {
		const execute = vi.fn(async () => {
			throw makeExecaError({
				stderr: "CondaEnvironmentNotFoundError: Could not find environment: ghost",
			});
		});
		const service = new CondaService({
			condaBinPath: "/opt/conda/bin/conda",
			condaFilesRoot: "/tmp/conda-root",
			logger: silentLogger,
			// oxlint-disable-next-line no-explicit-any
			execute: execute as any,
		});
		await expect(service.remove({ name: "ghost" })).rejects.toSatisfy((error) => {
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
