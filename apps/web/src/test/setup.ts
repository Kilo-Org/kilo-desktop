import { DEFAULT_APP_THEME_PREFERENCES, themeCss } from "@kilo-desktop/ui/themes";

import "../globals.css";

// Tests have no index.html pre-paint bootstrap, so paint the default theme the
// way it would. A separate id keeps it beneath `#app-theme`, which tests clear.
const defaultTheme = document.createElement("style");
defaultTheme.id = "test-default-theme";
defaultTheme.textContent = themeCss(DEFAULT_APP_THEME_PREFERENCES);
document.head.append(defaultTheme);
