import { createFileRoute } from "@tanstack/react-router";

function HomePage() {
	return (
		<div className="flex min-h-full items-center justify-center p-8">
			<p className="text-muted-foreground text-sm">Welcome to Anaconda Agentic Desktop.</p>
		</div>
	);
}

export const Route = createFileRoute("/")({
	component: HomePage,
});
