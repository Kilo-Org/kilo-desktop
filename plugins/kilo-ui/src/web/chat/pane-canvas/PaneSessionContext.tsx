import { createContext, use, type ReactNode } from "react";

const PaneSessionContext = createContext<string | null>(null);

export function PaneSessionProvider({
	children,
	sessionId,
}: {
	readonly children: ReactNode;
	readonly sessionId: string | null;
}) {
	return <PaneSessionContext value={sessionId}>{children}</PaneSessionContext>;
}

export function usePaneSessionId(): string | null {
	return use(PaneSessionContext);
}
