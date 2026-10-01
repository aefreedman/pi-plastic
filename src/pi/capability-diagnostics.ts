import { getPatchBackendCapabilityWarning } from "../operations/patch";

export type CapabilityDiagnosticContext = {
  hasUI?: boolean;
  ui?: { notify?: (message: string, level: "warning") => void };
};

type PatchCapabilityWarningGetter = () => Promise<string | undefined>;

export const __plasticCapabilityDiagnosticInternals = {
  createPatchCapabilityWarningNotifier(getWarning: PatchCapabilityWarningGetter = () => getPatchBackendCapabilityWarning()) {
    let emitted = false;
    return async (ctx: CapabilityDiagnosticContext): Promise<void> => {
      if (emitted || !ctx.hasUI || typeof ctx.ui?.notify !== "function") return;
      const warning = await getWarning();
      if (!warning) return;
      emitted = true;
      ctx.ui.notify(warning, "warning");
    };
  },
};

export const notifyPatchCapabilityWarning = __plasticCapabilityDiagnosticInternals.createPatchCapabilityWarningNotifier();
