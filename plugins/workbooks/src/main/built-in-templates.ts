import blankManifest from "../../templates/blank/workbook.json";
import blankGuide from "../../templates/blank/AGENTS.md?raw";
import codingManifest from "../../templates/coding/workbook.json";
import codingGuide from "../../templates/coding/AGENTS.md?raw";
import { templateFromFiles } from "./template-files";

/** The templates kilo.workbooks ships, by `template` contribution id. */
export const BUILT_IN_TEMPLATES = {
	coding: () => templateFromFiles(codingManifest, { "AGENTS.md": codingGuide }),
	blank: () => templateFromFiles(blankManifest, { "AGENTS.md": blankGuide }),
} as const;
