import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importAnacondaDesktopModels, type Entry, type File } from "./anaconda-desktop";

const homedirMock = vi.hoisted(() => vi.fn());
vi.mock("node:os", async (importOriginal) => {
	const original = (await importOriginal()) as object;
	return {
		...original,
		homedir: homedirMock,
	};
});

class FakeLogger {
	debug = vi.fn();
	error = vi.fn();
	info = vi.fn();
	warn = vi.fn();
}

describe("Anaconda Desktop Models", () => {
	const add = vi.fn();
	let logger: FakeLogger;
	let root: string;
	let tempdir: string;

	beforeEach(async () => {
		vi.unstubAllEnvs();
		vi.resetAllMocks();

		logger = new FakeLogger();

		const prefix = join(tmpdir(), "kilo-test-");
		tempdir = await mkdtemp(prefix);

		homedirMock.mockReturnValue(tempdir);
		vi.stubEnv("APPDATA", undefined);
		vi.stubEnv("XDG_CONFIG_HOME", undefined);

		switch (process.platform) {
			case "darwin":
				root = join(tempdir, "Library", "Application Support", "anaconda-desktop");
				break;
			case "win32":
				root = join(tempdir, "AppData", "Roaming", "anaconda-desktop");
				break;
			default:
				root = join(tempdir, ".config", "anaconda-desktop");
				break;
		}
		await mkdir(root, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempdir, { recursive: true, force: true });
	});

	it("imports nothing if anaconda-desktop config is missing", async () => {
		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalled();
	});

	it("imports nothing if anaconda-desktop config is invalid", async () => {
		await writeFile(join(root, "config.json"), "!");

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalled();
	});

	it("imports nothing if model-registry is missing", async () => {
		await writeFile(join(root, "config.json"), JSON.stringify({ downloadLocation: tempdir }));

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalled();
	});

	it("imports nothing if model-registry is invalid", async () => {
		await writeFile(join(root, "config.json"), JSON.stringify({ downloadLocation: tempdir }));
		await writeFile(join(root, "model-registry.db"), "!");

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalled();
	});

	it("imports nothing if anaconda-desktop config lacks a download location", async () => {
		await writeFile(join(root, "config.json"), JSON.stringify({}));

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith("[anaconda-desktop] invalid configuration");
	});

	it("imports nothing if model-registry does not match its schema", async () => {
		await writeFile(join(root, "config.json"), JSON.stringify({ downloadLocation: tempdir }));
		await writeFile(join(root, "model-registry.db"), JSON.stringify({ collections: "none" }));

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith("[anaconda-desktop] invalid registry schema");
	});

	it("imports nothing if model-registry has no models collection", async () => {
		await writeFile(join(root, "config.json"), JSON.stringify({ downloadLocation: tempdir }));
		await writeFile(
			join(root, "model-registry.db"),
			JSON.stringify({ collections: [{ name: "other", data: [] }] }),
		);

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith("[anaconda-desktop] no models collection found");
	});

	it("skips registry entries that are not models", async () => {
		await writeFile(join(root, "config.json"), JSON.stringify({ downloadLocation: tempdir }));
		await writeFile(
			join(root, "model-registry.db"),
			JSON.stringify({ collections: [{ name: "models", data: [{ id: "no-files" }] }] }),
		);

		await importAnacondaDesktopModels(add, logger);
		expect(add).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith("Imported 0 of 0 models from Anaconda Desktop");
	});

	describe("imports valid downloaded models", () => {
		let downloadLocation: string;

		// valid file
		const fileA: File = {
			format: "gguf",
			id: "c841a895-aa65-4aa4-a568-69716c5a3e4c",
			isDownloaded: true,
			name: "TEST_FILE.gguf",
			quantization: "q4c",
			sizeBytes: 179568427348,
		};
		// wrong format
		const fileB = {
			format: "weights",
			id: "c8489f9f-db46-4826-81ec-757108835128",
			isDownloaded: true,
			name: "TEST_FILE.weights",
			quantization: "q4c",
			sizeBytes: 180156398,
		};
		// not downloaded
		const fileC = {
			format: "gguf",
			id: "98d9f232-8182-46e2-9272-7cf1c6768c1c",
			isDownloaded: false,
			name: "TEST_FILE_2.gguf",
			quantization: "q4c",
			sizeBytes: 262634224338,
		};
		// another valid file
		const fileD: File = {
			format: "gguf",
			id: "f723cb20-627e-4160-8613-91986c3e98ae",
			isDownloaded: true,
			name: "DEMO_FILE.gguf",
			quantization: "q8c",
			sizeBytes: 698125831441,
		};
		// invalid record
		const fileE = {
			id: "3ecd8280-2c39-4180-b528-48d73be6d8c2",
			isDownloaded: true,
			name: "SOME_NAME.gguf",
			quantization: "q8c",
			sizeBytes: 773122858715,
		};
		// valid record, but file is missing by default
		const fileF: File = {
			format: "gguf",
			id: "30ae187d-15b2-44ef-9a5b-78d32c7c7afa",
			isDownloaded: true,
			name: "MISSING_FILE.gguf",
			quantization: "q2c",
			sizeBytes: 493539261725,
		};

		const modelA: Entry = {
			files: [fileA, fileB],
			id: "6bcd64de-6b29-48e6-97fd-333ae7319432",
			name: "MODEL_A",
			publisher: "PUBLISHER_X",
		};
		const modelB: Entry = {
			files: [fileC, fileD, fileE],
			id: "7fc1f5ef-2a04-4d8c-9ec5-ce1e5ecd134b",
			name: "MODEL_B",
		};
		const modelC: Entry = {
			files: [fileF],
			id: "11ad7e20-b118-4bb8-83a6-4262e6522036",
			name: "MODEL_C",
			publisher: "PUBLISHER_Z",
		};

		const checkAdd = (model: Entry, file: File) => {
			expect(add).toHaveBeenCalledWith({
				catalog: {
					modelId: model.id,
					publisher: model.publisher,
					quantizationId: file.id,
				},
				name: `${model.name} (${file.quantization})`,
				path: join(downloadLocation, model.id, file.name),
				sizeBytes: file.sizeBytes,
			});
		};

		beforeEach(async () => {
			downloadLocation = join(tempdir, "models");
			await writeFile(join(root, "config.json"), JSON.stringify({ downloadLocation }));
			await writeFile(
				join(root, "model-registry.db"),
				JSON.stringify({
					collections: [
						{
							name: "models",
							data: [modelA, modelB, modelC],
						},
					],
				}),
			);

			await mkdir(join(downloadLocation, modelA.id), { recursive: true });
			await mkdir(join(downloadLocation, modelB.id), { recursive: true });
			await mkdir(join(downloadLocation, modelC.id), { recursive: true });

			await writeFile(join(downloadLocation, modelA.id, fileA.name), "!");
			await writeFile(join(downloadLocation, modelA.id, fileB.name), "!");
			await writeFile(join(downloadLocation, modelB.id, fileC.name), "!");
			await writeFile(join(downloadLocation, modelB.id, fileD.name), "!");
			await writeFile(join(downloadLocation, modelB.id, fileE.name), "!");
		});

		it("imports all models", async () => {
			await importAnacondaDesktopModels(add, logger);
			expect(add).toHaveBeenCalledTimes(2); // 2 files registered
			checkAdd(modelA, fileA);
			checkAdd(modelB, fileD);
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Imported 2 of 2 models"));
		});

		it("skips failed imports and continues importing following files", async () => {
			await writeFile(join(downloadLocation, modelC.id, fileF.name), "!");

			// allow add to fail once
			add.mockRejectedValueOnce(new Error("some_specific_error_message"));

			await importAnacondaDesktopModels(add, logger);
			expect(add).toHaveBeenCalledTimes(3); // should not stop after the first fail
			checkAdd(modelA, fileA);
			checkAdd(modelB, fileD);
			checkAdd(modelC, fileF);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("some_specific_error_message"),
			);
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Imported 2 of 3 models"));
		});

		it("reports import failures that are not errors", async () => {
			add.mockRejectedValueOnce("disk full");

			await importAnacondaDesktopModels(add, logger);
			expect(logger.warn).toHaveBeenCalledWith(
				`Failed to import model "${modelA.name} (${fileA.quantization})" from Anaconda Desktop: disk full`,
			);
		});
	});
});
