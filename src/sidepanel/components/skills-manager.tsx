import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Skill } from "../../shared/protocol";
import { validateSkillsImport } from "../../shared/skills";
import {
  deleteSkill,
  getSkills,
  resetSkills,
  saveSkill,
  setSkills,
} from "../../shared/storage";

interface SkillsManagerProps {
  onSkillsChanged?: () => void;
}

export function SkillsManager({ onSkillsChanged }: SkillsManagerProps) {
  const [skills, setSkillsState] = useState<Skill[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSkills();
  }, []);

  async function loadSkills() {
    try {
      const list = await getSkills();
      setSkillsState(list);
    } catch {
      setError("Could not load skills.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSkill(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);

    if (!name.trim() || !prompt.trim()) {
      setError("Please provide both a skill name and prompt instruction.");
      return;
    }

    try {
      await saveSkill({
        name: name.trim(),
        prompt: prompt.trim(),
      });
      setName("");
      setPrompt("");
      setStatus(`Skill "${name.trim()}" saved.`);
      await loadSkills();
      onSkillsChanged?.();
    } catch {
      setError("Could not save skill.");
    }
  }

  async function handleDeleteSkill(id: string, skillName: string) {
    if (!window.confirm(`Delete skill "${skillName}"?`)) return;
    setStatus(null);
    setError(null);
    try {
      await deleteSkill(id);
      setStatus(`Deleted "${skillName}".`);
      await loadSkills();
      onSkillsChanged?.();
    } catch {
      setError("Could not delete skill.");
    }
  }

  function handleExportSkills() {
    try {
      const jsonStr = JSON.stringify(skills, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sahayak-skills-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Skills exported to JSON.");
    } catch {
      setError("Could not export skills.");
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setStatus(null);
    setError(null);

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("Import failed: file is not valid JSON.");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      // Security validation (Slice 15 step 3)
      const validation = validateSkillsImport(parsed);
      if (!validation.ok) {
        setError(`Import rejected: ${validation.error}`);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      await setSkills(validation.data);
      setSkillsState(validation.data);
      setStatus(`Successfully imported ${validation.data.length} skills.`);
      onSkillsChanged?.();
    } catch {
      setError("Could not read import file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleResetSkills() {
    if (!window.confirm("Reset all skills back to the default starter recipes?")) return;
    setStatus(null);
    setError(null);
    try {
      const starters = await resetSkills();
      setSkillsState(starters);
      setStatus("Reset back to starter skills.");
      onSkillsChanged?.();
    } catch {
      setError("Could not reset skills.");
    }
  }

  if (loading) {
    return <p className="muted">Loading skills…</p>;
  }

  return (
    <div className="skills-manager-container">
      <div className="skills-header">
        <h3>One-Click Prompt Skills</h3>
        <p className="muted">
          Manage reusable prompt recipes. Run them from the top pill row in Chat or Act.
        </p>
      </div>

      <div className="skills-toolbar">
        <button
          type="button"
          className="skills-action-btn"
          onClick={handleExportSkills}
          title="Export skills as a JSON file"
        >
          📥 Export JSON
        </button>

        <label className="skills-action-btn import-label" title="Import skills from a JSON file">
          📤 Import JSON
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </label>

        <button
          type="button"
          className="skills-action-btn secondary"
          onClick={handleResetSkills}
          title="Restore starter prompt recipes"
        >
          ↺ Reset Starters
        </button>
      </div>

      {status ? <div className="status success" style={{ marginBottom: 8 }}>{status}</div> : null}
      {error ? <div className="status error" style={{ marginBottom: 8 }}>{error}</div> : null}

      <div className="skills-list">
        {skills.map((skill) => (
          <div key={skill.id} className="skill-card">
            <div className="skill-card-header">
              <span className="skill-card-name">
                <strong>{skill.name}</strong>
              </span>
              <button
                type="button"
                className="skill-delete-btn"
                onClick={() => handleDeleteSkill(skill.id, skill.name)}
                title="Delete this skill"
              >
                ✕
              </button>
            </div>
            <p className="skill-card-prompt">{skill.prompt}</p>
          </div>
        ))}
      </div>

      <form className="add-skill-form" onSubmit={handleAddSkill}>
        <h4>Add Custom Skill</h4>
        <label>
          Skill Name
          <input
            type="text"
            placeholder='e.g. "Draft WhatsApp invite" or "Key definitions"'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label>
          Prompt Recipe
          <textarea
            rows={3}
            placeholder="Describe what Sahayak should do with the content..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>

        <button type="submit" className="add-skill-btn">
          + Add Skill
        </button>
      </form>
    </div>
  );
}

