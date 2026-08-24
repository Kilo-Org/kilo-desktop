import { Toaster } from "@anaconda-agentic-desktop/ui/components/sonner";
import { Outlet } from "@tanstack/react-router";

import { AppSidebarLayout } from "@/components/layout/AppSidebarLayout";
import { PLUGIN_NAV } from "@/features/plugin-nav-entries";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";
import { ThemeProvider, useColorScheme } from "@/platform/theme/ThemeProvider";

function ThemedToaster() {
	const { resolved } = useColorScheme();
	return <Toaster theme={resolved} />;
}

export function App() {
	return (
		<ThemeProvider>
			<AppSidebarLayout navEntries={PLUGIN_NAV} settingsSections={PLUGIN_SETTINGS}>
				<Outlet />
				<ThemedToaster />
			</AppSidebarLayout>
		</ThemeProvider>
	);
}
