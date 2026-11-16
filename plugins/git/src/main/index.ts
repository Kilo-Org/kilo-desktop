import { createGitMainEntry } from "./entry";
import { productionRepositoryOptions } from "./repository";

export { createGitMainEntry, type GitMainOptions } from "./entry";

/** kilo.git's main entry: the system git binary, patches in the OS temp folder. */
export const gitMainEntry = createGitMainEntry(productionRepositoryOptions);
