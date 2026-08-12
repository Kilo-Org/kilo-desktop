import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { notebookBrowserRegister } from "./browserRegister.js";

export { NotebookView } from "./NotebookView.js";
export { NotebookIcon } from "lucide-react";

export function browserRegister(mainSdk: MainSdk): void {
	notebookBrowserRegister(mainSdk);
}
