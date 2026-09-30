import { open } from "node:fs/promises";

export type PeMachine = "x86" | "x64" | "arm64";

export interface PeImports {
	/** Undefined for machine types we never ship (e.g. ARM32, IA-64). */
	readonly machine: PeMachine | undefined;
	/** Load-time and delay-load DLL dependencies, in table order. */
	readonly dlls: readonly string[];
}

export type ReadAt = (offset: number, length: number) => Promise<Buffer>;

const MACHINES = new Map<number, PeMachine>([
	[0x014c, "x86"],
	[0x8664, "x64"],
	[0xaa64, "arm64"],
]);
const PE_SIGNATURE = 0x0000_4550;
const PE32_MAGIC = 0x010b;
const PE32_PLUS_MAGIC = 0x020b;
const IMPORT_DIRECTORY = 1;
const DELAY_IMPORT_DIRECTORY = 13;
const SECTION_HEADER_SIZE = 40;
const IMPORT_DESCRIPTOR_SIZE = 20;
const IMPORT_DESCRIPTOR_NAME_OFFSET = 12;
const DELAY_IMPORT_DESCRIPTOR_SIZE = 32;
const DELAY_IMPORT_DESCRIPTOR_NAME_OFFSET = 4;
const MAX_DLL_NAME_LENGTH = 260;
// Bounds a corrupt, unterminated descriptor table.
const MAX_DESCRIPTORS = 4096;

interface Section {
	readonly virtualAddress: number;
	readonly virtualSize: number;
	readonly rawOffset: number;
}

function fileOffsetForRva(sections: readonly Section[], rva: number): number | undefined {
	const section = sections.find(
		(candidate) =>
			rva >= candidate.virtualAddress && rva < candidate.virtualAddress + candidate.virtualSize,
	);
	return section ? section.rawOffset + (rva - section.virtualAddress) : undefined;
}

async function readDllName(readAt: ReadAt, offset: number): Promise<string> {
	const bytes = await readAt(offset, MAX_DLL_NAME_LENGTH);
	const end = bytes.indexOf(0);
	return bytes.toString("latin1", 0, end === -1 ? bytes.length : end);
}

async function readDescriptorNames(
	readAt: ReadAt,
	sections: readonly Section[],
	tableRva: number,
	descriptorSize: number,
	nameOffset: number,
): Promise<string[]> {
	const tableOffset = tableRva === 0 ? undefined : fileOffsetForRva(sections, tableRva);
	if (tableOffset === undefined) return [];
	const names: string[] = [];
	for (let index = 0; index < MAX_DESCRIPTORS; index++) {
		const descriptor = await readAt(tableOffset + index * descriptorSize, descriptorSize);
		if (descriptor.length < descriptorSize) break;
		const nameRva = descriptor.readUInt32LE(nameOffset);
		if (nameRva === 0) break;
		const nameFileOffset = fileOffsetForRva(sections, nameRva);
		if (nameFileOffset !== undefined) names.push(await readDllName(readAt, nameFileOffset));
	}
	return names;
}

/**
 * Reads the DLL names a PE image links against, without loading it. Returns
 * undefined when the bytes are not a PE image.
 */
export async function parsePeImports(readAt: ReadAt): Promise<PeImports | undefined> {
	const dosHeader = await readAt(0, 64);
	if (dosHeader.length < 64 || dosHeader.toString("latin1", 0, 2) !== "MZ") return undefined;
	const peOffset = dosHeader.readUInt32LE(0x3c);
	const coffHeader = await readAt(peOffset, 24);
	if (coffHeader.length < 24 || coffHeader.readUInt32LE(0) !== PE_SIGNATURE) return undefined;

	const machine = MACHINES.get(coffHeader.readUInt16LE(4));
	const sectionCount = coffHeader.readUInt16LE(6);
	const optionalHeaderSize = coffHeader.readUInt16LE(20);
	const optionalHeaderOffset = peOffset + 24;
	const optionalHeader = await readAt(optionalHeaderOffset, optionalHeaderSize);
	const magic = optionalHeader.length >= 2 ? optionalHeader.readUInt16LE(0) : 0;
	const dataDirectoryStart =
		magic === PE32_PLUS_MAGIC ? 112 : magic === PE32_MAGIC ? 96 : undefined;
	if (dataDirectoryStart === undefined || optionalHeader.length < dataDirectoryStart) {
		return undefined;
	}
	const directoryCount = optionalHeader.readUInt32LE(dataDirectoryStart - 4);
	const directoryRva = (index: number): number => {
		const entryOffset = dataDirectoryStart + index * 8;
		if (index >= directoryCount || entryOffset + 8 > optionalHeader.length) return 0;
		return optionalHeader.readUInt32LE(entryOffset);
	};

	const sectionTable = await readAt(
		optionalHeaderOffset + optionalHeaderSize,
		sectionCount * SECTION_HEADER_SIZE,
	);
	const sections: Section[] = [];
	for (let index = 0; index < sectionCount; index++) {
		const header = index * SECTION_HEADER_SIZE;
		if (header + SECTION_HEADER_SIZE > sectionTable.length) break;
		const virtualSize = sectionTable.readUInt32LE(header + 8);
		const rawSize = sectionTable.readUInt32LE(header + 16);
		sections.push({
			virtualAddress: sectionTable.readUInt32LE(header + 12),
			virtualSize: Math.max(virtualSize, rawSize),
			rawOffset: sectionTable.readUInt32LE(header + 20),
		});
	}

	const dlls = [
		...(await readDescriptorNames(
			readAt,
			sections,
			directoryRva(IMPORT_DIRECTORY),
			IMPORT_DESCRIPTOR_SIZE,
			IMPORT_DESCRIPTOR_NAME_OFFSET,
		)),
		...(await readDescriptorNames(
			readAt,
			sections,
			directoryRva(DELAY_IMPORT_DIRECTORY),
			DELAY_IMPORT_DESCRIPTOR_SIZE,
			DELAY_IMPORT_DESCRIPTOR_NAME_OFFSET,
		)),
	];
	return { machine, dlls };
}

/** Reads only the header and import tables, so multi-hundred-MB executables stay cheap. */
export async function readPeImportsFromFile(file: string): Promise<PeImports | undefined> {
	const handle = await open(file, "r");
	try {
		return await parsePeImports(async (offset, length) => {
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await handle.read(buffer, 0, length, offset);
			return buffer.subarray(0, bytesRead);
		});
	} catch (error) {
		throw new Error(`Could not read PE imports from ${file}`, { cause: error });
	} finally {
		await handle.close();
	}
}
