import path from "node:path";

/**
 * The Kilo server is not Electron and cannot read `app.asar`, so it loads
 * `@runtimed/node` from the unpacked copy packaging leaves beside it.
 */
export function translateAsarToUnpackedPath(inputPath: string, separator = path.sep): string {
	const asarSegment = `${separator}app.asar${separator}`;
	if (!inputPath.includes(asarSegment)) return inputPath;
	return inputPath.replace(asarSegment, `${separator}app.asar.unpacked${separator}`);
}
