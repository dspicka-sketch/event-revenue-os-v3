import { ROLES, SPECIALIST_KEYS, type SpecialistKey } from "../domain/roles";

export const MAX_SPECIALISTS_PER_RUN = 4;

/**
 * Chief-of-staff dispatch: pick only the specialists relevant to the question.
 * Deterministic keyword scoring keeps dispatch auditable and testable; an explicit
 * role list from the requester takes precedence.
 */
export function planSpecialists(question: string, explicit?: SpecialistKey[]): { role: SpecialistKey; task: string }[] {
  if (explicit && explicit.length) {
    const uniq = [...new Set(explicit)].filter((r) => SPECIALIST_KEYS.includes(r)).slice(0, SPECIALIST_KEYS.length);
    return uniq.map((role) => ({ role, task: taskFor(role, question) }));
  }
  const q = question.toLowerCase();
  const scored = SPECIALIST_KEYS.map((role) => ({
    role,
    score: ROLES[role].dispatchKeywords.reduce((n, k) => n + (q.includes(k) ? 1 : 0), 0),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || SPECIALIST_KEYS.indexOf(a.role) - SPECIALIST_KEYS.indexOf(b.role))
    .slice(0, MAX_SPECIALISTS_PER_RUN);
  const roles = scored.length ? scored.map((s) => s.role) : (["strategist"] as SpecialistKey[]);
  return roles.map((role) => ({ role, task: taskFor(role, question) }));
}

function taskFor(role: SpecialistKey, question: string): string {
  return `From the ${ROLES[role].title} perspective, address: "${question}". Scope: ${ROLES[role].responsibility} Deliver: ${ROLES[role].firstOutput}`;
}
