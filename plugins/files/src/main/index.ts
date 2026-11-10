import { createFilesMainEntry } from "./entry";

export { createFilesMainEntry, type ExternalEditorLauncher, type FilesMainOptions } from "./entry";

/** kilo.files' main entry: files on disk, external editors on the PATH. */
export const filesMainEntry = createFilesMainEntry();
