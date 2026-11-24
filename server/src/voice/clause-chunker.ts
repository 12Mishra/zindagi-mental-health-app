// Splits a streamed LLM reply into speakable clauses. Every clause becomes its own TTS utterance (with a falling
// end tone), so clauses end at sentence boundaries; only an over-long sentence is split, at a comma when possible.
const PAUSE_BOUNDARY = /[,;:—]/u;
const SENTENCE_BOUNDARY = /[.!?।]/u;
const MIN_PAUSE_SPLIT_WORDS = 4;
const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'sr', 'jr', 'prof', 'vs', 'etc', 'e.g', 'i.e', 'approx']);

export type ChunkerRules = { firstMinWords: number; firstMaxWords: number; laterMinWords: number; laterMaxWords: number };
export const DEFAULT_CHUNKER_RULES: ChunkerRules = { firstMinWords: 3, firstMaxWords: 14, laterMinWords: 6, laterMaxWords: 25 };

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
    const minWords = first ? this.rules.firstMinWords : this.rules.laterMinWords;
    const maxWords = first ? this.rules.firstMaxWords : this.rules.laterMaxWords;
    const text = this.buffer;
    for (let i = 0; i < text.length - 1; i++) {
      if (!SENTENCE_BOUNDARY.test(text[i]) || !this.cuttable(text, i)) continue;
      if (wordCount(text.slice(0, i + 1)) >= minWords) return this.cut(i + 1);
    }
    // No sentence end yet: once the clause is too long, cut at its last comma-like pause, else on a space.
    const words = [...text.matchAll(/\S+(?=\s)/gu)];
    if (words.length >= maxWords) {
      const word = words[maxWords - 1];
      const limit = word.index! + word[0].length;
      for (let i = limit - 1; i > 0; i--) {
        if (PAUSE_BOUNDARY.test(text[i]) && this.cuttable(text, i) && wordCount(text.slice(0, i + 1)) >= MIN_PAUSE_SPLIT_WORDS) {
          return this.cut(i + 1);
        }
      }
      return this.cut(limit);
    }
    return null;
  }

  /** Only cut when the following character is known to be a space, so "3.5" or "Dr.Smith" never split mid-token. */
  private cuttable(text: string, i: number) {
    if (!/\s/u.test(text[i + 1] ?? '') && text[i] !== '—') return false;
    return !(text[i] === '.' && this.isAbbreviation(text.slice(0, i)));
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
