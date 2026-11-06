import { useEffect, useState, type FormEvent } from "react";
import type { Settings } from "../../shared/protocol";
import { getSettings, setSettings } from "../../shared/storage";
import { ProfileForm } from "./profile";
import { SkillsManager } from "./skills-manager";

type SettingsProps = {
  onSaved?: (settings: Settings) => void;
};

export function SettingsForm({ onSaved }: SettingsProps) {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [groqApiKey, setGroqApiKey] = useState("");
  const [extraAllowlistText, setExtraAllowlistText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        setGeminiApiKey(settings.geminiApiKey);
        setGroqApiKey(settings.groqApiKey);
        setExtraAllowlistText((settings.extraAllowlist ?? []).join("\n"));
      } catch {
        if (!cancelled) {
          setError("Could not load settings.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const cleanedAllowlist = extraAllowlistText
        .split(/[\n,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const next = await setSettings({
        geminiApiKey: geminiApiKey.trim(),
        groqApiKey: groqApiKey.trim(),
        extraAllowlist: cleanedAllowlist,
      });
      setStatus("Settings saved on this device.");
      onSaved?.(next);
    } catch {
      setError("Could not save settings.");
    }
  }

  if (loading) {
    return <p className="muted">Loading settings…</p>;
  }

  return (
    <div className="settings-page">
      <form className="settings form" onSubmit={onSubmit}>
        <h3>API Keys</h3>
        <p className="muted">
          Keys stay in Chrome storage on this device. They are never committed to
          the repo.
        </p>

        <label>
          Gemini API key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste from Google AI Studio"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
          />
        </label>

        <label>
          Groq API key (optional)
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Text fallback only"
            value={groqApiKey}
            onChange={(e) => setGroqApiKey(e.target.value)}
          />
        </label>

        <div className="allowlist-settings-section" style={{ marginTop: 14 }}>
          <label>
            Allowed Hosts for Browser Actions
            <span className="muted" style={{ display: "block", fontSize: "0.78rem", fontWeight: "normal", marginTop: 2 }}>
              Default allowlist: <code>localhost</code> and <code>127.0.0.1</code>. Add additional trusted hosts you own below (one per line). Sensitive banking and payment domains are always blocked regardless of allowlist.
            </span>
            <textarea
              rows={3}
              placeholder="e.g.&#10;my-app.internal&#10;staging.example.com"
              value={extraAllowlistText}
              onChange={(e) => setExtraAllowlistText(e.target.value)}
              style={{ marginTop: 6 }}
            />
          </label>
        </div>

        <div className="actions" style={{ marginTop: 12 }}>
          <button type="submit">Save Settings</button>
          {status ? <span className="status">{status}</span> : null}
          {error ? <span className="status error">{error}</span> : null}
        </div>
      </form>

      <hr className="divider" style={{ margin: "20px 0" }} />

      <ProfileForm />

      <hr className="divider" style={{ margin: "20px 0" }} />

      <SkillsManager />
    </div>
  );
}
