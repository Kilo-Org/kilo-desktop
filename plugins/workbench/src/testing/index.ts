// Test host for plugins that contribute to kilo.workbench: boots the real
// shell and workbench with stand-ins for the plugins the workbench reads.
export {
	chat,
	fakeConversationsMain,
	fakeNotifications,
	fakeSessionsMain,
	fakeWorkspacesMain,
	NOW,
	renderWorkbench,
	session,
	workspace,
} from "../test/fakes";
