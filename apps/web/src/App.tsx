import { Outlet } from "@tanstack/react-router";

import { AppSidebarLayout } from "@/components/layout/AppSidebarLayout";
import { ThemeSync } from "@/features/theme/ThemeSync";

export function App() {
	return (
		<>
			<ThemeSync />
			<AppSidebarLayout>
				<Outlet />
			</AppSidebarLayout>
		</>
	);
}
