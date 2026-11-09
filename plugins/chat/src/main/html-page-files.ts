import { writeFile } from "node:fs/promises";

import type { WriteNewFile } from "./html-render";

/** Exclusive create (`wx`): an existing file or symlink at the path is left alone. */
export const writeNewFile: WriteNewFile = async (path, content) => {
	try {
		await writeFile(path, content, { encoding: "utf8", flag: "wx" });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") return false;
		throw error;
	}
};
