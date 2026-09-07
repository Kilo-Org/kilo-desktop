import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import {
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
	OctagonXIcon,
	Loader2Icon,
} from "lucide-react";

/**
 * Toast host. Theme-agnostic: the consuming app passes `theme` (e.g. from its
 * own color-scheme context) so the shared UI package stays decoupled from any
 * particular theming provider. Defaults to `"system"` when not provided.
 */
const Toaster = ({ theme = "system", ...props }: ToasterProps) => {
	return (
		<Sonner
			theme={theme}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius)",
					// Pin the close (X) button to the top-right corner of each toast.
					"--toast-close-button-start": "unset",
					"--toast-close-button-end": "0",
					"--toast-close-button-transform": "translate(35%, -35%)",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: "cn-toast",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster, toast };
