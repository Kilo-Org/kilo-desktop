import type { SDK } from "@kilo-desktop/feature-sdk";

import { registerHtmlRenderTool } from "./chat/html-render/html-render-tool.js";

export { AccountNavIcon } from "./account/AccountNavIcon.js";
export { AccountSettings } from "./account/AccountSettings.js";
export { kiloUiBrowserRegister as browserRegister } from "./browserRegister.js";
export { KiloProvidersNavIcon } from "./providers/KiloProvidersNavIcon.js";
export { KiloProvidersSettings } from "./providers/KiloProvidersSettings.js";
export { NotificationSettings } from "./chat/notifications/NotificationSettings.js";
export { BellIcon as NotificationsNavIcon } from "lucide-react";
export { ChatFeatureProvider } from "./chat/ChatFeatureProvider.js";
export {
	SessionPage,
	SessionPageHeaderActions,
	SessionPageHeaderLeading,
} from "./session/SessionPage.js";
export { OnboardingProvider } from "./onboarding/OnboardingProvider.js";
export { SessionList } from "./session/components/session-list.js";
export { WorkspaceBoardPage } from "./session/workspace-board/WorkspaceBoardPage.js";
export { WorkspaceBoardHeaderActions } from "./session/workspace-board/WorkspaceBoardHeaderActions.js";
export { SidebarKiloAccount } from "./account/SidebarKiloAccount.js";
export { WorkspacesFeatureProvider } from "./workspaces/WorkspacesFeatureProvider.js";
export { WorkspaceSelector } from "./workspaces/WorkspaceSelector.js";

export function webRegister(sdk: SDK): void {
	registerHtmlRenderTool(sdk);
}
