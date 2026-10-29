// Splits a streamed LLM reply into speakable clauses. The first clause is cut early so TTS can start quickly.
const FIRST_BOUNDARY = /[,.!?।;:—]/u;
const SENTENCE_BOUNDARY = /[.!?।]/u;
const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'sr', 'jr', 'prof', 'vs', 'etc', 'e.g', 'i.e', 'approx']);

export type ChunkerRules = { firstMinWords: number; firstMaxWords: number; laterMinWords: number; laterMaxWords: number };
export const DEFAULT_CHUNKER_RULES: ChunkerRules = { firstMinWords: 4, firstMaxWords: 10, laterMinWords: 6, laterMaxWords: 25 };

const wordCount = (text: string) => text.split(/\s+/u).filter(Boolean).length;

export class ClauseChunker {
  private buffer = '';
  private emitted = 0;
  constructor(private readonly rules: ChunkerRules = DEFAULT_CHUNKER_RULES) {}

  push(token: string): string[] {
    this.buffer += token;
    const clauses: string[] = [];
    for (let clause = this.next(); clause; clause = this.next()) clauses.push(clause);
    return clauses;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest) return [];
    this.emitted++;
    return [rest];
  }

  private next(): string | null {
    const first = this.emitted === 0;
    const boundary = first ? FIRST_BOUNDARY : SENTENCE_BOUNDARY;
    const minWords = first ? this.rules.firstMinWords : this.rules.laterMinWords;
    const maxWords = first ? this.rules.firstMaxWords : this.rules.laterMaxWords;
    const text = this.buffer;
    for (let i = 0; i < text.length - 1; i++) {
      if (!boundary.test(text[i])) continue;
      // Only cut when the following character is known to be a space, so "3.5" or "Dr.Smith" never split mid-token.
      if (!/\s/u.test(text[i + 1]) && text[i] !== '—') continue;
      if (text[i] === '.' && this.isAbbreviation(text.slice(0, i))) continue;
      if (wordCount(text.slice(0, i + 1)) >= minWords) return this.cut(i + 1);
    }
    // No usable punctuation yet: cut on a space boundary once the clause is long enough.
    const words = [...text.matchAll(/\S+(?=\s)/gu)];
    if (words.length >= maxWords) {
      const word = words[maxWords - 1];
      return this.cut(word.index! + word[0].length);
    }
    return null;
  }

  private isAbbreviation(before: string) {
    const word = /(\S+)$/u.exec(before)?.[1]?.toLowerCase() ?? '';
    return ABBREVIATIONS.has(word) || /^[a-z]$/u.test(word);
  }

  private cut(end: number) {
    const clause = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end).trimStart();
    if (!clause) return null;
    this.emitted++;
    return clause;
  }
}
