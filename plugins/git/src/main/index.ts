import { createGitMainEntry } from "./entry.js";

export { createGitMainEntry, type GitMainOptions } from "./entry.js";

/** kilo.git's main entry: the system git binary, patches in the OS temp folder. */
export const gitMainEntry = createGitMainEntry();
