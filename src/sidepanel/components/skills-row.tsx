import { useEffect, useState } from "react";
import type { Skill } from "../../shared/protocol";
import { getSkills } from "../../shared/storage";

interface SkillsRowProps {
  onSelectSkill: (skill: Skill) => void;
  filterPrefix?: string;
  refreshTrigger?: number;
}

export function SkillsRow({
  onSelectSkill,
  refreshTrigger = 0,
}: SkillsRowProps) {
  const [skills, setSkills] = useState<Skill[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getSkills();
        if (!cancelled) {
          setSkills(loaded);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  if (skills.length === 0) {
    return null;
  }

  function getSkillIcon(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes("exam") || lower.includes("note")) return "📝";
    if (lower.includes("hinglish") || lower.includes("explain")) return "🗣️";
    if (lower.includes("email") || lower.includes("reply")) return "✉️";
    if (lower.includes("fill") || lower.includes("form")) return "📋";
    return "⚡";
  }

  return (
    <div className="skills-row-container" aria-label="One-click skills">
      <div className="skills-row-scroll">
        {skills.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className="skill-pill-btn"
            onClick={() => onSelectSkill(skill)}
            title={skill.prompt}
          >
            <span className="skill-pill-icon">{getSkillIcon(skill.name)}</span>
            <span className="skill-pill-text">{skill.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

