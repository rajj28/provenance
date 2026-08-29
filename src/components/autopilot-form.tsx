"use client";

import { updateAutopilotAction } from "@/app/actions";
import { Button } from "@/components/ui";
import { AUTOPILOT_MODES, type AutopilotMode } from "@/lib/portfolio/autopilot";
import { useActionState, useState } from "react";

export function AutopilotForm({
  mode,
  minSignificance,
  minConfidence,
}: {
  mode: AutopilotMode;
  minSignificance: number;
  minConfidence: number;
}) {
  const [selected, setSelected] = useState<AutopilotMode>(mode);
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; ok?: boolean } | null, formData: FormData) => updateAutopilotAction(formData),
    null
  );

  const dot: Record<AutopilotMode, string> = {
    auto: "bg-pine",
    review: "bg-copper",
    draft: "bg-[#9b2c2c]",
  };

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        {AUTOPILOT_MODES.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-3 rounded-2xl border p-3 transition ${
              selected === option.value ? "border-copper bg-copper/5" : "border-ink/12 hover:border-ink/25"
            }`}
          >
            <input
              type="radio"
              name="autopilotMode"
              value={option.value}
              checked={selected === option.value}
              onChange={() => setSelected(option.value)}
              className="mt-1"
            />
            <span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={`inline-block h-2 w-2 rounded-full ${dot[option.value]}`} />
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">{option.blurb}</span>
            </span>
          </label>
        ))}
      </div>

      {selected === "auto" ? (
        <div className="rounded-2xl border border-ink/12 bg-white/60 p-3">
          <p className="text-xs text-ink-soft">
            Only items the curator recommends, that clear <em>both</em> bars, and that have no fields flagged uncertain
            will publish on their own. Everything else still waits for you.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-ink-soft">Minimum significance</span>
              <input
                type="number"
                name="minSignificance"
                min={0}
                max={100}
                defaultValue={minSignificance}
                className="mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-soft">Minimum confidence</span>
              <input
                type="number"
                name="minConfidence"
                min={0}
                max={100}
                defaultValue={minConfidence}
                className="mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm"
              />
            </label>
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="minSignificance" value={minSignificance} />
          <input type="hidden" name="minConfidence" value={minConfidence} />
        </>
      )}

      {state?.error ? <p className="text-sm text-[#9b2c2c]">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-pine">Autopilot updated.</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save autopilot"}
      </Button>
    </form>
  );
}
