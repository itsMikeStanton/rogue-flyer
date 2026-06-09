// Campaign: an ordered list of mission definitions + persistent progress.
//
// Each mission references an island (by worldConfig name), an escalating defense
// config, a Captain Dad briefing, and the objectives (consumed by missions.js).
// Escalation is pure data: the same target gets harder mission to mission.
// Progress (completed + unlocked ids) persists in localStorage.

const STORE = "rf.campaign";

// objectives[] use the missions.js shape: { type, priority, label, match }.
export const CAMPAIGN = [
  {
    id: "m1-first-assault",
    title: "First Assault",
    island: "Aerival",
    speaker: "Captain Dad",
    briefing: [
      "Listen up, ace. See that power plant on Aerival?",
      "Nobody's home yet. Fly out there and flatten it.",
      "Easy one to get your wings dirty. GO!",
    ],
    start: "air",
    defense: { fighters: 0, diff: 1 }, // undefended
    objectives: [
      { type: "destroy", priority: "primary", label: "Destroy the power plant", match: "powerplant" },
    ],
    reward: { unlock: "m2-hornets-nest" },
  },
  {
    id: "m2-hornets-nest",
    title: "Hornets' Nest",
    island: "Aerival",
    speaker: "Captain Dad",
    briefing: [
      "They know you're coming now. Same target — but it's guarded.",
      "Fighters on patrol and SAMs on the deck. Don't get cocky.",
      "Knock out the defenses if you can, then finish the plant.",
    ],
    start: "air",
    defense: { fighters: 2, diff: 1.1 },
    objectives: [
      { type: "destroy", priority: "primary", label: "Destroy the power plant", match: "powerplant" },
      { type: "destroy", priority: "optional", label: "Clear the SAM sites", match: "sam" },
    ],
    reward: { unlock: "m3-pushing-inland" },
  },
  {
    id: "m3-pushing-inland",
    title: "Pushing Inland",
    island: "Aerival",
    speaker: "Captain Dad",
    briefing: [
      "Good work. Now we push past the coast.",
      "Take out the radar net so the fleet can move in.",
      "Heavy air cover today — watch your six.",
    ],
    start: "air",
    defense: { fighters: 4, diff: 1.25 },
    objectives: [
      { type: "destroy", priority: "primary", label: "Knock out the radar net", match: "radar" },
      { type: "destroy", priority: "secondary", label: "Sink the enemy carrier", match: (t) => !!t.info },
    ],
    reward: { unlock: null },
  },
];

export function missionById(id) { return CAMPAIGN.find((m) => m.id === id) || null; }
export function firstMission() { return CAMPAIGN[0]; }
export function nextMission(id) {
  const i = CAMPAIGN.findIndex((m) => m.id === id);
  return i >= 0 && i + 1 < CAMPAIGN.length ? CAMPAIGN[i + 1] : null;
}

export function loadProgress() {
  let p = { completed: [], unlocked: [CAMPAIGN[0].id] };
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw);
      p.completed = Array.isArray(s.completed) ? s.completed : [];
      p.unlocked = Array.isArray(s.unlocked) && s.unlocked.length ? s.unlocked : [CAMPAIGN[0].id];
    }
  } catch (_) { /* ignore */ }
  if (!p.unlocked.includes(CAMPAIGN[0].id)) p.unlocked.push(CAMPAIGN[0].id);
  return p;
}

export function saveProgress(p) {
  try { localStorage.setItem(STORE, JSON.stringify(p)); } catch (_) { /* ignore */ }
}

export function isUnlocked(id, p) { return p.unlocked.includes(id); }
export function isComplete(id, p) { return p.completed.includes(id); }

// Mark a mission complete and unlock its reward. Returns the updated progress.
export function markComplete(id, p) {
  if (!p.completed.includes(id)) p.completed.push(id);
  const m = missionById(id);
  if (m && m.reward && m.reward.unlock && !p.unlocked.includes(m.reward.unlock)) p.unlocked.push(m.reward.unlock);
  saveProgress(p);
  return p;
}
