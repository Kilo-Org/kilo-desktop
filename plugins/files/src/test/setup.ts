import "./globals.css";

import { configureDesktopFocusManager } from "@kilo-desktop/sdk-react";

// Mirror the host (createDesktopQueryClient) so refetchOnWindowFocus in
// component tests observes the same focus events as production.
configureDesktopFocusManager();
