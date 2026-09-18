import { DialogDescription, DialogHeader, DialogTitle } from "@kilo-desktop/ui/components/dialog";

export function ModelCatalogDialogHeader() {
	return (
		<DialogHeader className="gap-0.5 px-4 pt-4 pr-3 pb-6 text-left">
			<DialogTitle className="text-base leading-tight">Local Model Catalog</DialogTitle>
			<DialogDescription className="text-sm leading-tight">
				Browse models from Anaconda and add them to your local model server.
			</DialogDescription>
		</DialogHeader>
	);
}
