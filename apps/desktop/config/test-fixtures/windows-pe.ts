export const PE_MACHINE = { x86: 0x014c, x64: 0x8664, arm64: 0xaa64, arm: 0x01c4 } as const;

const SECTION_RVA = 0x1000;
const SECTION_FILE_OFFSET = 0x200;
const DATA_DIRECTORY_COUNT = 16;

export interface PeImageOptions {
	readonly machine?: number;
	readonly format?: "pe32" | "pe32+";
	readonly imports?: readonly string[];
	readonly delayImports?: readonly string[];
}

/**
 * Minimal single-section PE image whose import and delay-import tables name
 * the given DLLs. Enough structure for the import reader, nothing loadable.
 */
export function buildPeImage(options: PeImageOptions = {}): Buffer {
	const imports = options.imports ?? [];
	const delayImports = options.delayImports ?? [];
	const pe32Plus = (options.format ?? "pe32+") === "pe32+";
	const dataDirectoryStart = pe32Plus ? 112 : 96;
	const optionalHeaderSize = dataDirectoryStart + DATA_DIRECTORY_COUNT * 8;
	const importTableSize = (imports.length + 1) * 20;
	const delayTableSize = (delayImports.length + 1) * 32;

	const names = [...imports, ...delayImports];
	const nameOffsets: number[] = [];
	let cursor = importTableSize + delayTableSize;
	for (const name of names) {
		nameOffsets.push(cursor);
		cursor += name.length + 1;
	}
	const sectionSize = cursor;

	const image = Buffer.alloc(SECTION_FILE_OFFSET + sectionSize);
	image.write("MZ", 0, "latin1");
	image.writeUInt32LE(0x40, 0x3c);
	image.writeUInt32LE(0x0000_4550, 0x40);
	image.writeUInt16LE(options.machine ?? PE_MACHINE.x64, 0x44);
	image.writeUInt16LE(1, 0x46);
	image.writeUInt16LE(optionalHeaderSize, 0x54);

	const optionalHeader = 0x58;
	image.writeUInt16LE(pe32Plus ? 0x020b : 0x010b, optionalHeader);
	image.writeUInt32LE(DATA_DIRECTORY_COUNT, optionalHeader + dataDirectoryStart - 4);
	if (imports.length > 0) {
		image.writeUInt32LE(SECTION_RVA, optionalHeader + dataDirectoryStart + 1 * 8);
	}
	if (delayImports.length > 0) {
		image.writeUInt32LE(
			SECTION_RVA + importTableSize,
			optionalHeader + dataDirectoryStart + 13 * 8,
		);
	}

	const sectionHeader = optionalHeader + optionalHeaderSize;
	image.writeUInt32LE(sectionSize, sectionHeader + 8);
	image.writeUInt32LE(SECTION_RVA, sectionHeader + 12);
	image.writeUInt32LE(sectionSize, sectionHeader + 16);
	image.writeUInt32LE(SECTION_FILE_OFFSET, sectionHeader + 20);

	imports.forEach((_, index) => {
		image.writeUInt32LE(SECTION_RVA + nameOffsets[index]!, SECTION_FILE_OFFSET + index * 20 + 12);
	});
	delayImports.forEach((_, index) => {
		image.writeUInt32LE(
			SECTION_RVA + nameOffsets[imports.length + index]!,
			SECTION_FILE_OFFSET + importTableSize + index * 32 + 4,
		);
	});
	names.forEach((name, index) => {
		image.write(name, SECTION_FILE_OFFSET + nameOffsets[index]!, "latin1");
	});
	return image;
}
