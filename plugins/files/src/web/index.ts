import type { SDK } from "@kilo-desktop/feature-sdk";

import { registerFileViewer } from "./files/integrations/file-viewer.js";
import { registerFilesWebMcpTools } from "./files/integrations/files-webmcp-tools.js";

export { FilesView } from "./files/FilesView.js";
export { FilesComposerTrigger } from "./files/mentions/FilesComposerTrigger.js";
export { FilesMarkdownExtension } from "./files/markdown/FilesMarkdownExtension.js";
export { FilesTabIcon } from "./files/file-icons/FilesTabIcon.js";
export type {
	FilesCapabilities,
	FileViewerCapability,
	OpenWorkspaceFileOptions,
} from "./files/integrations/file-viewer.js";

export function webRegister(sdk: SDK): void {
	registerFileViewer(sdk);
	registerFilesWebMcpTools(sdk);
}
