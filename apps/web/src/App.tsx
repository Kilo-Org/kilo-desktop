import { Toaster } from "@anaconda-agentic-desktop/ui/components/sonner";
import { Outlet } from "@tanstack/react-router";

import { AppSidebarLayout } from "@/components/layout/AppSidebarLayout";
import { PLUGIN_NAV } from "@/features/plugin-nav-entries";
import { PLUGIN_PAGES } from "@/features/plugin-pages";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";
import { ThemeProvider, useColorScheme } from "@/platform/theme/ThemeProvider";

function ThemedToaster() {
	const { resolved } = useColorScheme();
	// Bottom-right, lifted above the create-environment drawer's footer so a
	// persistent error toast never sits behind the Create button. `closeButton`
	// gives every toast an explicit dismiss control — required because error
	// toasts are persistent (`duration: Infinity`) and never auto-hide.
	return <Toaster theme={resolved} position="bottom-right" offset={{ bottom: 88 }} closeButton />;
}

export function App() {
	return (
		<ThemeProvider>
			<AppSidebarLayout
				navEntries={PLUGIN_NAV}
				pages={PLUGIN_PAGES}
				settingsSections={PLUGIN_SETTINGS}
			>
				<Outlet />
				<ThemedToaster />
			</AppSidebarLayout>
		</ThemeProvider>
	);
}
