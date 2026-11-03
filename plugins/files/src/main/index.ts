import { createFilesMainEntry } from "./entry.js";

export {
	createFilesMainEntry,
	type ExternalEditorLauncher,
	type FilesMainOptions,
} from "./entry.js";

/** kilo.files' main entry: files on disk, external editors on the PATH. */
export const filesMainEntry = createFilesMainEntry();
