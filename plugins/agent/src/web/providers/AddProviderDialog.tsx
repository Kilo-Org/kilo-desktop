import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { Separator } from "@kilo-desktop/ui/components/separator";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	WizardStepIndicator,
	type WizardStep,
} from "@kilo-desktop/ui/components/wizard-step-indicator";
import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";
import {
	EMBEDDED_CUSTOM_PROVIDER_CONTENT_CLASS_NAME,
	CustomProviderForm,
	type CustomProviderSubmitInput,
} from "./CustomProviderDialog";
import { ProviderConnectForm } from "./ProviderConnectDialog";
import type { ProviderRow } from "./provider-list";

type AddProviderStep = "choose" | "configure";
type ProviderChoice = { type: "catalog"; provider: ProviderRow } | { type: "custom" };

const STEPS: readonly WizardStep<AddProviderStep>[] = [
	{ id: "choose", label: "Choose provider" },
	{ id: "configure", label: "Configure" },
];

export function AddProviderDialog({
	open,
	providers,
	blockedIds,
	pending,
	connectError,
	saveError,
	onOpenChange,
	onResetConnect,
	onResetSave,
	onConnect,
	onSaveCustom,
}: {
	open: boolean;
	providers: readonly ProviderRow[];
	blockedIds: readonly string[];
	pending: boolean;
	connectError: string | null;
	saveError: string | null;
	onOpenChange: (open: boolean) => void;
	onResetConnect: () => void;
	onResetSave: () => void;
	onConnect: (provider: ProviderRow, apiKey: string) => Promise<void>;
	onSaveCustom: (input: CustomProviderSubmitInput) => Promise<void>;
}) {
	const [choice, setChoice] = useState<ProviderChoice | null>(null);
	const skipChooseStep = providers.length === 0;
	const step: AddProviderStep = choice ? "configure" : "choose";

	const changeOpen = (next: boolean) => {
		if (!next && pending) return;
		if (!next) setChoice(null);
		onOpenChange(next);
	};

	const back = () => {
		onResetConnect();
		onResetSave();
		setChoice(null);
	};

	// Rendered as the leading footer item: `sm:mr-auto` pins it left of the actions.
	const stepIndicator = skipChooseStep ? undefined : (
		<div className="flex items-center sm:mr-auto">
			<WizardStepIndicator
				steps={STEPS}
				currentStep={step}
				busy={pending}
				qaPrefix="kilo-providers-add"
				canSelect={(candidate) => candidate === "choose" || choice !== null}
				onSelect={(candidate) => {
					if (candidate === "choose") back();
				}}
			/>
		</div>
	);

	const custom = choice?.type === "custom" || skipChooseStep;
	const dialogQaId = custom
		? "kilo-providers-custom-dialog"
		: choice?.type === "catalog"
			? "kilo-providers-connect-dialog"
			: "kilo-providers-add-dialog";

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent
				data-qa-id={dialogQaId}
				style={{ transition: "none" }}
				className={cn("sm:max-w-2xl", custom && EMBEDDED_CUSTOM_PROVIDER_CONTENT_CLASS_NAME)}
			>
				{choice?.type === "catalog" ? (
					<ProviderConnectForm
						providerName={choice.provider.name}
						pending={pending}
						error={connectError}
						stepIndicator={stepIndicator}
						onBack={back}
						onSubmit={(apiKey) => onConnect(choice.provider, apiKey)}
					/>
				) : custom ? (
					<CustomProviderForm
						existing={null}
						blockedIds={blockedIds}
						pending={pending}
						error={saveError}
						stepIndicator={stepIndicator}
						{...(!skipChooseStep ? { onBack: back } : {})}
						onCancel={() => changeOpen(false)}
						onSubmit={onSaveCustom}
					/>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Add AI Provider</DialogTitle>
						</DialogHeader>

						<div className="flex flex-col gap-3">
							<p className="text-muted-foreground text-xs font-medium">Popular providers</p>
							<ItemGroup className="grid gap-2 sm:grid-cols-2">
								{providers.map((provider) => (
									<ProviderChoiceItem
										key={provider.id}
										provider={provider}
										disabled={pending}
										onSelect={() => {
											onResetConnect();
											setChoice({ type: "catalog", provider });
										}}
									/>
								))}
							</ItemGroup>
							<Separator />
							<Item
								render={<button type="button" disabled={pending} />}
								variant="outline"
								size="sm"
								className="bg-card hover:bg-muted min-w-0 flex-nowrap text-left"
								onClick={() => {
									onResetSave();
									setChoice({ type: "custom" });
								}}
								data-qa-id="kilo-providers-add-custom"
							>
								<ItemMedia className="border-border bg-background size-8 rounded-lg border">
									<PlusIcon className="size-4" />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>Custom AI provider</ItemTitle>
								</ItemContent>
								<ItemActions>
									<ArrowRightIcon className="text-muted-foreground size-4" />
								</ItemActions>
							</Item>
						</div>

						<DialogFooter>
							{stepIndicator}
							<Button type="button" variant="outline" onClick={() => changeOpen(false)}>
								Cancel
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ProviderChoiceItem({
	provider,
	disabled,
	onSelect,
}: {
	provider: ProviderRow;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<Item
			render={<button type="button" disabled={disabled} />}
			variant="outline"
			size="sm"
			className="bg-card hover:bg-muted min-w-0 flex-nowrap text-left"
			onClick={onSelect}
			data-qa-id={`kilo-providers-add-${provider.id}`}
		>
			<ItemMedia className="border-border bg-background size-8 rounded-lg border">
				<ProviderIcon
					provider={provider.id}
					variant="color"
					size={18}
					fallbackLabel={provider.name}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{provider.name}</ItemTitle>
			</ItemContent>
			<ItemActions>
				<ArrowRightIcon className="text-muted-foreground size-4" />
			</ItemActions>
		</Item>
	);
}
