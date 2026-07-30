import { Link, Outlet } from "@tanstack/react-router";

import { ThemeSync } from "@/features/theme/ThemeSync";

export function App() {
	return (
		<>
			<ThemeSync />
			<nav className="border-border bg-muted/50 flex gap-4 border-b px-5 py-2 text-sm">
				<Link
					to="/"
					className="text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
				>
					Todos
				</Link>
				<Link
					to="/sdk-explorer"
					className="text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
				>
					SDK Producer
				</Link>
				<Link
					to="/sdk-consumer"
					className="text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
				>
					SDK Consumer
				</Link>
				<Link
					to="/split"
					className="text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-medium"
				>
					Split (both)
				</Link>
			</nav>
			<Outlet />
		</>
	);
}
