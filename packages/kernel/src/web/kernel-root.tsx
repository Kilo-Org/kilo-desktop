import { KernelRoot as RootPoint, KernelWindowView } from "../builtins/extension-points";
import { RenderContribution, useExclusive, useExtensions, useKernel } from "./react";
import { RecoveryScreen } from "./recovery-screen";

/**
 * The renderer's root. The main window renders the winning `kernel/root`
 * contribution; a secondary window renders the `kernel/window-view` it was
 * opened for. Without either, the kernel's recovery screen is shown.
 */
export function KernelRoot() {
	const kernel = useKernel();
	return kernel.window.role === "secondary" ? <SecondaryWindowRoot /> : <MainWindowRoot />;
}

function MainWindowRoot() {
	const { winner } = useExclusive(RootPoint);
	if (!winner) return <RecoveryScreen reason="no-root" />;
	return <RenderContribution contribution={winner} />;
}

/** A window view fills the window, so `h-full` and size containment inside it resolve. */
const WINDOW_VIEW_FRAME_STYLE = {
	display: "flex",
	flexDirection: "column",
	width: "100%",
	height: "100svh",
	minHeight: 0,
} as const;

function SecondaryWindowRoot() {
	const kernel = useKernel();
	const views = useExtensions(KernelWindowView);
	const view = views.find((candidate) => candidate.key === kernel.window.view);
	if (!view?.implementation) return <RecoveryScreen reason="missing-view" />;
	return (
		<div data-kernel-window-view={view.key} style={WINDOW_VIEW_FRAME_STYLE}>
			<RenderContribution contribution={view} props={{ params: kernel.window.params }} />
		</div>
	);
}
