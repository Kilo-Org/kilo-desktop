import { create } from "zustand";

type RevealChatPaneState = {
	nonce: number;
	chatId: string | null;
	reveal: (chatId: string) => void;
};

export const useRevealChatPane = create<RevealChatPaneState>((set) => ({
	nonce: 0,
	chatId: null,
	reveal: (chatId) => set((state) => ({ nonce: state.nonce + 1, chatId })),
}));
