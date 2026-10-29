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

export type TurnLanguage = 'en' | 'hi';
export type PolicyText = Record<TurnLanguage, string>;

// Common Roman-script Hindi words (extends ROMAN_HINDI in training/prepare_dialogue.py). One hit marks the turn Hinglish.
const ROMAN_HINDI = new Set(['nahi', 'nahin', 'kya', 'kyun', 'kyu', 'mujhe', 'mujhko', 'mera', 'meri', 'mere', 'hai', 'hain',
  'hoon', 'hu', 'tha', 'thi', 'yaar', 'samajh', 'kaise', 'kaisa', 'kuch', 'bahut', 'bohot', 'accha', 'acha', 'theek', 'thik',
  'lagta', 'lagti', 'raha', 'rahi', 'rahe', 'kar', 'karna', 'karta', 'karti', 'ghar', 'padhai', 'dost', 'mann', 'dimaag',
  'pareshan', 'abhi', 'aaj', 'kal', 'bhi', 'aur', 'lekin', 'matlab', 'koi', 'sab', 'ke', 'ka', 'ki', 'ko', 'se']);

/** Decide the voice language once per student turn so the accent never flips between clauses. */
export function turnLanguage(text: string): TurnLanguage {
  if (/[ऀ-ॿ]/u.test(text)) return 'hi';
  return text.toLowerCase().split(/[^a-z]+/).some(word => ROMAN_HINDI.has(word)) ? 'hi' : 'en';
}

// TODO(counsellor): the team's counsellor must approve the exact wording of these fixed messages before any pilot.
export const SAFETY_CLARIFICATION: PolicyText = {
  en: 'I want to check on your safety. Are you in immediate danger or thinking of hurting yourself right now?',
  hi: 'मैं आपकी सुरक्षा के बारे में पूछना चाहती हूँ। क्या आप अभी किसी खतरे में हैं, या खुद को नुकसान पहुँचाने के बारे में सोच रहे हैं?',
};
export const URGENT_SUPPORT: PolicyText = {
  en: 'I am really sorry you are facing this, and I am glad you told me. Please call Tele-MANAS at 14416 right now, it is free and open all day and night, or call 112 in an emergency. If you can, reach a trusted person near you.',
  hi: 'मुझे बहुत दुख है कि आप इससे गुज़र रहे हैं, और अच्छा किया कि आपने मुझे बताया। कृपया अभी टेली-मानस को 14416 पर कॉल करें, यह मुफ़्त है और दिन-रात उपलब्ध है, या आपातकाल में 112 पर कॉल करें। हो सके तो अपने पास किसी भरोसेमंद व्यक्ति से संपर्क करें।',
};
export const RESPONSE_UNAVAILABLE: PolicyText = {
  en: 'Lisa cannot safely respond right now. Please try again in a moment.',
  hi: 'लिसा अभी सुरक्षित रूप से जवाब नहीं दे पा रही है। कृपया थोड़ी देर में फिर से कोशिश करें।',
};

const FIXED_TEXTS = new Set([SAFETY_CLARIFICATION, URGENT_SUPPORT, RESPONSE_UNAVAILABLE].flatMap(message => [message.en, message.hi]));
export const isFixedPolicyText = (text: string) => FIXED_TEXTS.has(text);
export const isServiceMessage = (text: string) => text === RESPONSE_UNAVAILABLE.en || text === RESPONSE_UNAVAILABLE.hi;
