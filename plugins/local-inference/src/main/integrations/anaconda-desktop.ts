import { access, constants, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AddLocalModelInput } from "../inference/LocalInferenceService.js";

interface Logger {
	debug(message: string): void;
	error(message: string): void;
	info(message: string): void;
	warn(message: string): void;
}

const configSchema = z.object({
	downloadLocation: z.string(),
});

const registrySchema = z.object({
	collections: z.array(
		z.object({
			name: z.string(),
			data: z.array(z.unknown()),
		}),
	),
});

const entrySchema = z.object({
	files: z.array(z.unknown()),
	id: z.string(),
	name: z.string(),
	publisher: z.string().optional(),
});
export type Entry = z.infer<typeof entrySchema>;

const fileSchema = z.object({
	format: z.literal("gguf"),
	id: z.string(),
	isDownloaded: z.literal(true),
	name: z.string(),
	quantization: z.string(),
	sizeBytes: z.number().int(),
});
export type File = z.infer<typeof fileSchema>;

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const findAnacondaDesktopModels = async (logger: Logger): Promise<AddLocalModelInput[]> => {
	try {
		let root: string;
		switch (process.platform) {
			case "darwin":
				root = join(homedir(), "Library", "Application Support", "anaconda-desktop");
				break;

			case "win32":
				root = join(
					process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
					"anaconda-desktop",
				);
				break;

			default:
				root = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "anaconda-desktop");
				break;
		}

		const config = configSchema.safeParse(
			JSON.parse(await readFile(join(root, "config.json"), "utf8")),
		);
		if (!config.success) {
			logger.debug("[anaconda-desktop] invalid configuration");
			return [];
		}

		const registry = registrySchema.safeParse(
			JSON.parse(await readFile(join(root, "model-registry.db"), "utf8")),
		);
		if (!registry.success) {
			logger.debug("[anaconda-desktop] invalid registry schema");
			return [];
		}

		const models = registry.data.collections.find((c) => c.name === "models");
		if (!models) {
			logger.debug("[anaconda-desktop] no models collection found");
			return [];
		}

		const result: AddLocalModelInput[] = [];
		for (const rawEntry of models.data) {
			const entry = entrySchema.safeParse(rawEntry);
			if (!entry.success) continue;

			for (const rawFile of entry.data.files) {
				const file = fileSchema.safeParse(rawFile);
				if (!file.success) continue;

				const location = join(config.data.downloadLocation, entry.data.id, file.data.name);
				try {
					await access(location, constants.F_OK);
				} catch {
					continue;
				}
				result.push({
					catalog: {
						modelId: entry.data.id,
						publisher: entry.data.publisher,
						quantizationId: file.data.id,
					},
					name: `${entry.data.name} (${file.data.quantization})`,
					path: location,
					sizeBytes: file.data.sizeBytes,
				});
			}
		}
		return result;
	} catch (error) {
		logger.debug(`[anaconda-desktop] scanning for models failed: ${message(error)}`);
		return [];
	}
};

export const importAnacondaDesktopModels = async (
	add: (input: AddLocalModelInput) => Promise<unknown>,
	logger: Logger,
) => {
	const models = await findAnacondaDesktopModels(logger);
	let succeeded = 0;
	for (const model of models) {
		try {
			await add(model);
			++succeeded;
		} catch (error) {
			logger.warn(
				`Failed to import model "${model.name}" from Anaconda Desktop: ${message(error)}`,
			);
		}
	}
	logger.info(`Imported ${succeeded} of ${models.length} models from Anaconda Desktop`);
};
