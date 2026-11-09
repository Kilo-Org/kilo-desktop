import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildPeImage, PE_MACHINE } from "./test-fixtures/windows-pe.js";
import { parsePeImports, readPeImportsFromFile } from "./windows-pe-imports.js";

function readerFor(image: Buffer) {
	return async (offset: number, length: number) => image.subarray(offset, offset + length);
}

describe("PE import reader", () => {
	it("lists load-time and delay-load DLLs of a 64-bit image", async () => {
		const image = buildPeImage({
			machine: PE_MACHINE.arm64,
			imports: ["KERNEL32.dll", "VCRUNTIME140.dll"],
			delayImports: ["node.exe"],
		});

		await expect(parsePeImports(readerFor(image))).resolves.toEqual({
			machine: "arm64",
			dlls: ["KERNEL32.dll", "VCRUNTIME140.dll", "node.exe"],
		});
	});

	it("reads 32-bit images", async () => {
		const image = buildPeImage({
			machine: PE_MACHINE.x86,
			format: "pe32",
			imports: ["MSVCP140.dll"],
		});

		await expect(parsePeImports(readerFor(image))).resolves.toEqual({
			machine: "x86",
			dlls: ["MSVCP140.dll"],
		});
	});

	it("reports machines we do not ship as unknown", async () => {
		const image = buildPeImage({ machine: PE_MACHINE.arm, imports: ["kernel32.dll"] });

		await expect(parsePeImports(readerFor(image))).resolves.toMatchObject({ machine: undefined });
	});

	it("reports an image without import tables as having no dependencies", async () => {
		await expect(parsePeImports(readerFor(buildPeImage()))).resolves.toEqual({
			machine: "x64",
			dlls: [],
		});
	});

	it("rejects bytes that are not a PE image", async () => {
		const notPe = Buffer.from("#!/bin/sh\necho not a PE image\n".padEnd(128, " "));
		const dosStubOnly = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(126)]);

		await expect(parsePeImports(readerFor(notPe))).resolves.toBeUndefined();
		await expect(parsePeImports(readerFor(dosStubOnly))).resolves.toBeUndefined();
	});

	it("reads imports from a file on disk", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-pe-imports-"));
		try {
			const file = path.join(directory, "addon.node");
			await writeFile(file, buildPeImage({ imports: ["VCRUNTIME140.dll"] }));

			await expect(readPeImportsFromFile(file)).resolves.toEqual({
				machine: "x64",
				dlls: ["VCRUNTIME140.dll"],
			});
		} finally {
			await rm(directory, { recursive: true });
		}
	});
});
