export const POLICY_VERSION = 'prototype-2026-10-05-v1';

export type Triage = { level: 'LOW' | 'ELEVATED' | 'URGENT' | 'UNKNOWN'; action: string; evidence?: string };
export type Review = { decision: 'ALLOW' | 'BLOCK' | 'UNKNOWN'; reasonCode: string };

// Conservative, auditable first-pass signals. This is not a clinical classifier.
const urgentPatterns = [
  /\b(?:i (?:want to|am going to|plan to) (?:kill myself|end my life)|i(?:'m| am) suicidal|suicide plan)\b/i,
  /(?:मैं|मुझे).{0,35}(?:आत्महत्या|खुदकुशी|जान देना|मर जाना)/u,
  /\b(?:khudkushi|aatmahatya|apni jaan (?:lena|dena)|kill myself)\b/i,
];
const ambiguousPatterns = [
  /\b(?:suicide|self harm|hurt myself|die|marna|jaan dena)\b/i,
  /(?:आत्महत्या|खुदकुशी|मरना|खुद को नुकसान)/u,
];
const negation = /\b(?:not|never|don't|do not|nahi|nahin)\b|(?:नहीं|नही)/iu;

export function triageStableUtterance(text: string): Triage {
  const value = text.trim().slice(0, 2000);
  if (!value) return { level: 'UNKNOWN', action: 'ask_to_repeat' };
  const quoted = /["“”]/u.test(value) || /\b(?:someone said|a quote|my friend said)\b/i.test(value);
  if (urgentPatterns.some(pattern => pattern.test(value))) {
    if (quoted || negation.test(value)) return { level: 'UNKNOWN', action: 'clarify_safety', evidence: value.slice(0, 160) };
    return { level: 'URGENT', action: 'local_support_prompt', evidence: value.slice(0, 160) };
  }
  if (ambiguousPatterns.some(pattern => pattern.test(value))) {
    return { level: 'UNKNOWN', action: 'clarify_safety', evidence: value.slice(0, 160) };
  }
  return { level: 'LOW', action: 'continue' };
}

const blockedResponsePatterns = [
  /\b(?:you (?:definitely )?have (?:depression|anxiety|bipolar|ptsd)|i diagnose you)\b/i,
  /\b(?:stop taking|increase your dose|take [0-9]+ ?mg|guaranteed (?:cure|recovery))\b/i,
  /(?:तुम्हें|आपको).{0,20}(?:डिप्रेशन है|दवा बंद कर)/u,
];

export function reviewLisaSegment(text: string, triage: Triage): Review {
  if (!text.trim() || text.length > 1200) return { decision: 'BLOCK', reasonCode: 'invalid_length' };
  if (triage.level !== 'LOW') return { decision: 'BLOCK', reasonCode: 'student_safety_unresolved' };
  if (blockedResponsePatterns.some(pattern => pattern.test(text))) return { decision: 'BLOCK', reasonCode: 'unsafe_claim_or_advice' };
  return { decision: 'ALLOW', reasonCode: 'deterministic_policy_pass' };
}

export const SAFETY_CLARIFICATION = 'I want to check on your safety. Are you in immediate danger or thinking of hurting yourself right now?';
export const URGENT_SUPPORT = 'I am sorry you are facing this. If you are in immediate danger, please contact local emergency services or a trusted person near you now.';
export const RESPONSE_UNAVAILABLE = 'Lisa cannot safely respond right now. Please try again in a moment.';
