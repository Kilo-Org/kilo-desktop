import { Toaster } from "@anaconda-agentic-desktop/ui/components/sonner";
import { Outlet } from "@tanstack/react-router";

import { AppSidebarLayout } from "@/components/layout/AppSidebarLayout";
import { ThemeProvider, useColorScheme } from "@/platform/theme/ThemeProvider";

function ThemedToaster() {
	const { resolved } = useColorScheme();
	return <Toaster theme={resolved} />;
}

export function App() {
	return (
		<ThemeProvider>
			<AppSidebarLayout>
				<Outlet />
				<ThemedToaster />
			</AppSidebarLayout>
		</ThemeProvider>
	);
}
