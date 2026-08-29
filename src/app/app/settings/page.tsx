import { requireUser } from "@/lib/session";
import { Card } from "@/components/ui";
import { ProfileForm } from "@/components/profile-form";
import { AutopilotForm } from "@/components/autopilot-form";
import { settingsOf } from "@/lib/portfolio/autopilot";

export default async function SettingsPage() {
  const user = await requireUser();
  const autopilot = settingsOf(user);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Settings</p>
        <h1 className="serif mt-2 text-4xl">Narrative and access</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Target role changes ranking, not the facts. Disconnect sources from the Sources page. Tokens are stored
          encrypted and never shown again.
        </p>
      </div>
      <Card className="max-w-xl">
        <h2 className="serif text-2xl">Autopilot</h2>
        <p className="mt-1 text-sm text-ink-soft">
          How much this runs without you. Every automatic action is logged and reversible — an auto-published item is
          identical to one you approved by hand, and you can edit or unpublish it at any time.
        </p>
        <div className="mt-4">
          <AutopilotForm
            mode={autopilot.mode}
            minSignificance={autopilot.minSignificance}
            minConfidence={autopilot.minConfidence}
          />
        </div>
      </Card>

      <Card className="max-w-xl">
        <ProfileForm user={user} />
      </Card>
    </div>
  );
}
