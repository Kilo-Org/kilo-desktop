import { DialogDescription, DialogHeader, DialogTitle } from "@kilo-desktop/ui/components/dialog";

export function ModelCatalogDialogHeader() {
	return (
		<DialogHeader className="px-4 pt-4 pr-3 pb-6 text-left">
			<DialogTitle>Local Model Catalog</DialogTitle>
			<DialogDescription className="text-sm leading-tight">
				Browse models from Anaconda and add them to your local model server.
			</DialogDescription>
		</DialogHeader>
	);
}
