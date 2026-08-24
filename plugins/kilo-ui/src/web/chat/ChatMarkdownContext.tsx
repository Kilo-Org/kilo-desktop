import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { ChatMarkdownExtensionContext } from "./chat-markdown-extensions.js";

const ChatMarkdownContext = createContext<ChatMarkdownExtensionContext | null>(null);

export function ChatMarkdownProvider({
	sessionId,
	workspaceFolders,
	children,
}: ChatMarkdownExtensionContext & { readonly children: ReactNode }) {
	const value = useMemo(() => ({ sessionId, workspaceFolders }), [sessionId, workspaceFolders]);
	return <ChatMarkdownContext.Provider value={value}>{children}</ChatMarkdownContext.Provider>;
}

export function useChatMarkdownContext(): ChatMarkdownExtensionContext | null {
	return useContext(ChatMarkdownContext);
}
