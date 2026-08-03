import { Outlet } from "@tanstack/react-router";

import { AppSidebarLayout } from "@/components/layout/AppSidebarLayout";
import { ThemeProvider } from "@/platform/theme/ThemeProvider";

export function App() {
	return (
		<ThemeProvider>
			<AppSidebarLayout>
				<Outlet />
			</AppSidebarLayout>
		</ThemeProvider>
	);
}
