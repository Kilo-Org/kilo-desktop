import { Outlet } from "@tanstack/react-router";

import { ThemeSync } from "@/features/theme/ThemeSync";

export function App() {
	return (
		<>
			<ThemeSync />
			<Outlet />
		</>
	);
}
