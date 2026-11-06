import { useEffect, useState, type FormEvent } from "react";
import type { Language, UserProfile } from "../../shared/protocol";
import { clearProfile, getProfile, setProfile } from "../../shared/storage";

interface ProfileFormProps {
  onSaved?: (profile: UserProfile) => void;
}

export function ProfileForm({ onSaved }: ProfileFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [college, setCollege] = useState("");
  const [skills, setSkills] = useState("");
  const [links, setLinks] = useState("");
  const [preferredTone, setPreferredTone] = useState("polite and concise");
  const [preferredLanguage, setPreferredLanguage] = useState<Language>("en");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile();
        if (cancelled) return;
        setName(p.name);
        setEmail(p.email ?? "");
        setCollege(p.college);
        setSkills(p.skills);
        setLinks(p.links);
        setPreferredTone(p.preferredTone || "polite and concise");
        setPreferredLanguage(p.preferredLanguage ?? "en");
      } catch {
        if (!cancelled) setError("Could not load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);

    try {
      const updated = await setProfile({
        name: name.trim(),
        email: email.trim(),
        college: college.trim(),
        skills: skills.trim(),
        links: links.trim(),
        preferredTone: preferredTone.trim(),
        preferredLanguage,
      });
      setStatus("Profile saved on this device.");
      onSaved?.(updated);
    } catch {
      setError("Could not save profile.");
    }
  }

  async function handleClear() {
    if (!window.confirm("Clear all profile fields?")) return;
    try {
      await clearProfile();
      setName("");
      setEmail("");
      setCollege("");
      setSkills("");
      setLinks("");
      setPreferredTone("polite and concise");
      setPreferredLanguage("en");
      setStatus("Profile cleared.");
    } catch {
      setError("Could not clear profile.");
    }
  }

  if (loading) {
    return <p className="muted">Loading profile…</p>;
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <h3>Local Profile Memory</h3>
        <p className="muted">
          Your profile helps Sahayak write personalised replies and draft allowlisted form-fills.
          Data is stored strictly on this device and is <strong>never</strong> shared on sensitive pages.
        </p>
      </div>

      <div className="profile-security-notice" role="note">
        <span className="shield-icon">🛡️</span>
        <span>
          <strong>Zero Passwords:</strong> Sahayak never asks for or stores passwords, OTPs, or payment card details.
        </span>
      </div>

      <form className="profile-form" onSubmit={handleSubmit}>
        <div className="profile-field-row">
          <label>
            Full Name
            <input
              type="text"
              placeholder="e.g. Priya Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label>
            Email Address
            <input
              type="email"
              placeholder="e.g. priya@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>

        <div className="profile-field-row">
          <label>
            College / University
            <input
              type="text"
              placeholder="e.g. IIT Delhi"
              value={college}
              onChange={(e) => setCollege(e.target.value)}
            />
          </label>

          <label>
            Preferred Tone
            <select
              value={preferredTone}
              onChange={(e) => setPreferredTone(e.target.value)}
            >
              <option value="polite and concise">Polite & Concise</option>
              <option value="formal and professional">Formal & Professional</option>
              <option value="warm and encouraging">Warm & Encouraging</option>
              <option value="casual and direct">Casual & Direct</option>
            </select>
          </label>
        </div>

        <div className="profile-field-row">
          <label>
            Key Skills
            <input
              type="text"
              placeholder="e.g. Python, TypeScript, React, Machine Learning"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
            />
          </label>

          <label>
            Preferred Language
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as Language)}
            >
              <option value="en">English</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </label>
        </div>

        <label>
          Links & Portfolio
          <input
            type="text"
            placeholder="e.g. GitHub: github.com/username, Portfolio: example.com"
            value={links}
            onChange={(e) => setLinks(e.target.value)}
          />
        </label>

        <div className="profile-actions">
          <button type="submit" className="profile-save-btn">
            Save Profile
          </button>
          <button
            type="button"
            className="profile-clear-btn"
            onClick={handleClear}
          >
            Clear
          </button>
          {status ? <span className="status success">{status}</span> : null}
          {error ? <span className="status error">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}

