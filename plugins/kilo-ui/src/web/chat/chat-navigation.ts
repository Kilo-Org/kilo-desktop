export const CHAT_ROUTE_PATH = "/plugins/chat";

type ChatNavigation = {
	location: { peek(): { path: string } };
	navigate(path: string): void;
};

export function isChatRoutePath(path: string): boolean {
	return path === CHAT_ROUTE_PATH || path.startsWith(`${CHAT_ROUTE_PATH}/`);
}

export function navigateToChat(navigation: ChatNavigation): void {
	if (!isChatRoutePath(navigation.location.peek().path)) {
		navigation.navigate(CHAT_ROUTE_PATH);
	}
}
