export const CHAT_ROUTE_PATH = "/plugins/chat";

type ChatNavigation = {
	location: { peek(): { path: string } };
	navigate(path: string): void;
};

export function navigateToChat(navigation: ChatNavigation): void {
	const path = navigation.location.peek().path;
	if (path !== CHAT_ROUTE_PATH && !path.startsWith(`${CHAT_ROUTE_PATH}/`)) {
		navigation.navigate(CHAT_ROUTE_PATH);
	}
}
