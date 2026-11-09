import { stat } from "node:fs/promises";

/**
 * Helper method to stat a path and check both that it exists and that it's
 * a directory.
 */
export const directoryExists = async (path: string): Promise<boolean> => {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
};
