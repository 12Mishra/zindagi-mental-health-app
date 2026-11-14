export type MessageLang = 'en' | 'hi';

export const isMessageLang = (value: unknown): value is MessageLang => value === 'en' || value === 'hi';

/** First name only, letters (any script), spaces trimmed to the first word; never anything else from the profile. */
export function firstNameOf(fullName: string): string {
  const word = fullName.trim().split(/\s+/)[0] ?? '';
  const cleaned = word.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30);
  return cleaned || 'Your friend';
}

/**
 * The ONLY place contact-message text is built. It takes the student's first name and a language and nothing else:
 * no risk level, topic, mood, conversation text or assessment can reach a contact through this function.
 * The counsellor must approve the final wording before launch (see docs/trusted-contacts-plan.md).
 */
export function checkInTemplate(firstName: string, lang: MessageLang): string {
  if (lang === 'hi') {
    return `नमस्ते, ${firstName} ने आपको Zindagi पर अपने भरोसेमंद व्यक्ति के रूप में जोड़ा है। अगर आप आज उन्हें कॉल कर लें या उनका हालचाल पूछ लें तो उन्हें बहुत अच्छा लगेगा। यह एक स्वचालित संदेश है और इसमें कोई अन्य जानकारी साझा नहीं की गई है। तुरंत मदद के लिए: Tele-MANAS 14416।`;
  }
  return `Hi, ${firstName} has added you on Zindagi as someone they trust. They would really appreciate it if you could call or check in on them today. This is an automated message and no other details are shared. For urgent help: Tele-MANAS 14416.`;
}
