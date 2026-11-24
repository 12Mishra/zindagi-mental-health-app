import assert from 'node:assert/strict';
import test from 'node:test';
import { ClauseChunker } from './clause-chunker';

const run = (text: string, tokenSize = 3) => {
  const chunker = new ClauseChunker();
  const clauses: string[] = [];
  for (let i = 0; i < text.length; i += tokenSize) clauses.push(...chunker.push(text.slice(i, i + tokenSize)));
  return [...clauses, ...chunker.flush()];
};

test('first clause waits for the sentence end instead of cutting at a comma', () => {
  const chunker = new ClauseChunker();
  assert.deepEqual(chunker.push('That sounds really hard, and'), []);
  assert.deepEqual(chunker.push(' I am here.'), []);
  assert.deepEqual(chunker.push(' Tell'), ['That sounds really hard, and I am here.']);
});

test('first clause is cut at fourteen words without punctuation', () => {
  assert.deepEqual(run('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'),
    ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen', 'fifteen sixteen']);
});

test('an over-long sentence is split at its last comma, not mid-phrase', () => {
  assert.deepEqual(run('When exams pile up and everyone expects so much from you, it can feel like there is no room left to breathe at all'),
    ['When exams pile up and everyone expects so much from you,', 'it can feel like there is no room left to breathe at all']);
});

test('later clauses split at sentence ends after six words and flush the remainder', () => {
  assert.deepEqual(run('I hear you, exams can feel heavy. It makes sense that you are tired right now. Want to talk?'),
    ['I hear you, exams can feel heavy.', 'It makes sense that you are tired right now.', 'Want to talk?']);
});

test('Devanagari danda ends a clause', () => {
  assert.deepEqual(run('मैं समझ सकती हूँ कि यह मुश्किल है। आप अभी कैसा महसूस कर रहे हैं, थोड़ा बताइए। ठीक है'),
    ['मैं समझ सकती हूँ कि यह मुश्किल है।', 'आप अभी कैसा महसूस कर रहे हैं, थोड़ा बताइए।', 'ठीक है']);
});

test('Roman Hinglish splits on punctuation like English', () => {
  assert.deepEqual(run('Yaar, exams ka stress samajh aata hai. Thoda break lena bhi zaroori hai na?'),
    ['Yaar, exams ka stress samajh aata hai.', 'Thoda break lena bhi zaroori hai na?']);
});

test('abbreviations and decimals are never split', () => {
  assert.deepEqual(run('You could talk to Dr. Mehta about it today. Sleep 7.5 hours if you can manage that.'),
    ['You could talk to Dr. Mehta about it today.', 'Sleep 7.5 hours if you can manage that.']);
});

test('flush returns nothing for an empty buffer', () => {
  const chunker = new ClauseChunker();
  assert.deepEqual(chunker.flush(), []);
  assert.deepEqual(chunker.push('   '), []);
  assert.deepEqual(chunker.flush(), []);
});
