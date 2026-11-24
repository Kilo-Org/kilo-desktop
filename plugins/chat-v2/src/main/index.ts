import { createChatMainEntry } from "./entry";
import { writeNewFile } from "./html-render/files";

export { createChatMainEntry, type ChatMainOptions } from "./entry";

/** kilo.chat's main entry: pages saved with node fs. */
export const chatMainEntry = createChatMainEntry({ writeNewFile });
