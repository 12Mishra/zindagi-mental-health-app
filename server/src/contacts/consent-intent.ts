import type { ContactRelationship } from '../generated/prisma/client';

/**
 * What a student's spoken or typed reply means while a support prompt is open.
 * This is intent, never consent: an accept only opens the confirm sheet on the phone; nothing is sent until the student taps Send.
 */
export type ConsentIntent = 'message' | 'call' | 'accept' | 'decline' | 'none';
export type ConsentResult = { intent: ConsentIntent; contactId?: string };
export type OfferContact = { id: string; name: string; relationship: ContactRelationship };

// ASCII \b does not work for Devanagari, so those patterns carry no word boundary and are kept specific.
const NEGATED_ACTION = /\b(?:don'?t|do not|dont|never|can'?t|cannot|mat|nahi|nahin|na)\s+(?:\w+\s+){0,2}?(?:call|phone|message|msg|text|whatsapp|tell|send|bhej|bata|batao)\b|(?:मत|नहीं|नही)\s*(?:कॉल|फ़ोन|फोन|मैसेज|भेज|बता)|(?:कॉल|फ़ोन|फोन|मैसेज|भेज|बता)\S*\s*(?:मत|नहीं|नही)|\b(?:call|phone|message|msg|bhej|bata)\w*\s+(?:mat|nahi|nahin)\b/iu;
const DECLINE = /\b(?:no|nope|nah|not now|not yet|later|no thanks|no thank you|leave it|it'?s fine|i'?m fine|nahi|nahin|nai|mat|rehne do|rahne do|abhi nahi|baad mein|zaroorat nahi)\b|(?:नहीं|नही|मत|रहने दो|अभी नहीं|बाद में)/iu;
const AFFIRM = /^(?:yes|yeah|yea|yep|yup|ok|okay|okk|sure|please|alright|go ahead|do it|haan|haa|han|ha|ji|ji haan|theek hai|thik hai|thik h|chalo|kar do|karo|ho jaye)\b|^(?:हाँ|हां|हा|जी|ठीक है|कर दो|चलो)/iu;
const CALL = /\b(?:call|phone|ring|dial|baat karni|baat karna|baat karwa|baat kara)\b|(?:कॉल|फ़ोन|फोन|बात कर)/iu;
const MESSAGE = /\b(?:message|msg|text|whatsapp|sms|send|inform|let (?:him|her|them) know|tell(?!\s+(?:you|me)\b)|bata do|batao|bata de|bhej|bhejo|bhej do)\b|(?:मैसेज|संदेश|भेज|बता दो|बताओ|बता दें)/iu;

const RELATIONSHIP_WORDS: Record<ContactRelationship, RegExp> = {
  FRIEND: /\b(?:friend|dost|yaar|bestie)\b|दोस्त/iu,
  ROOMMATE: /\b(?:roommate|room ?mate|flatmate)\b/iu,
  SIBLING: /\b(?:sister|brother|sis|bro|didi|bhaiya|bhai|behen|behan)\b|(?:दीदी|भैया|भाई|बहन)/iu,
  FAMILY: /\b(?:mom|mum|mummy|mother|maa|dad|papa|father|parents?|family|uncle|aunt|aunty|chacha|mama|nani|dadi)\b|(?:माँ|मां|मम्मी|पापा|पिताजी|परिवार)/iu,
  PARTNER: /\b(?:partner|boyfriend|girlfriend|bf|gf|husband|wife)\b/iu,
  MENTOR: /\b(?:mentor|sir|ma'?am|teacher|professor|prof)\b/iu,
  COUNSELLOR: /\b(?:counsell?or|therapist)\b/iu,
  OTHER: /(?!)/u,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The one contact the reply names, by first name first and then by relationship; ambiguous or none gives undefined. */
export function matchContact(text: string, contacts: OfferContact[]): string | undefined {
  const byName = contacts.filter(c => {
    const first = c.name.trim().split(/\s+/)[0];
    return first.length >= 2 && new RegExp(`(?<![\\p{L}\\p{M}])${escape(first)}(?![\\p{L}\\p{M}])`, 'iu').test(text);
  });
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) return undefined;
  const byRelation = contacts.filter(c => RELATIONSHIP_WORDS[c.relationship].test(text));
  return byRelation.length === 1 ? byRelation[0].id : undefined;
}

/**
 * Pure and conservative: anything unclear is 'none' and changes nothing. A bare "yes"/"no" counts only in a short reply,
 * so a long sentence that happens to contain "yes" or "no" is not read as an answer to the offer.
 */
export function classifyConsent(input: string, contacts: OfferContact[]): ConsentResult {
  const text = input.trim().toLowerCase().replace(/[.,!?।]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) return { intent: 'none' };
  const n = words(text);
  const contactId = matchContact(text, contacts);
  const withContact = (intent: ConsentIntent): ConsentResult => (contactId ? { intent, contactId } : { intent });

  if (NEGATED_ACTION.test(text)) return { intent: 'decline' };
  const call = CALL.test(text);
  const message = MESSAGE.test(text);
  const affirm = AFFIRM.test(text);
  const decline = DECLINE.test(text);

  // "no, call her" or "yes... actually no": mixed signals are left to the sheet.
  if (decline && (affirm || call || message)) return { intent: 'none' };
  if (decline) return n <= 8 ? { intent: 'decline' } : { intent: 'none' };
  if (call && message) return n <= 12 ? withContact('accept') : { intent: 'none' };
  // An action verb counts when it is plainly an answer: short, or with a yes, or naming one of their people.
  if (call || message) {
    if (n <= 8 || affirm || contactId) return withContact(call ? 'call' : 'message');
    return { intent: 'none' };
  }
  if (affirm && n <= 6) return withContact('accept');
  // "my sister" / "Priya" in reply to "who would you like to reach?"
  if (contactId && n <= 4) return withContact('accept');
  return { intent: 'none' };
}
