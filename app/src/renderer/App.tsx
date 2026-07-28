import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";

import { ThemeSync } from "@/features/theme/ThemeSync";
import { subscribeQueryInvalidation } from "@/lib/query/ipc-bridge";

export function App() {
	const queryClient = useQueryClient();

	useEffect(() => subscribeQueryInvalidation(queryClient), [queryClient]);

	return (
		<>
			<ThemeSync />
			<Outlet />
		</>
	);
}
