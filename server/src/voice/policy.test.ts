import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLisaSegment, triageStableUtterance } from './policy';

test('explicit urgent English, Hindi and Hinglish signals route urgently', () => {
  assert.equal(triageStableUtterance('I want to kill myself tonight').level, 'URGENT');
  assert.equal(triageStableUtterance('मुझे आत्महत्या करनी है').level, 'URGENT');
  assert.equal(triageStableUtterance('I am thinking about khudkushi').level, 'URGENT');
});

test('negation and quotation remain uncertain', () => {
  assert.equal(triageStableUtterance('I do not want to kill myself').level, 'UNKNOWN');
  assert.equal(triageStableUtterance('My friend said "I want to kill myself"').level, 'UNKNOWN');
});

test('response review blocks diagnosis and unresolved student safety', () => {
  const low = triageStableUtterance('I feel stressed about exams');
  assert.equal(reviewLisaSegment('You definitely have depression.', low).decision, 'BLOCK');
  assert.equal(reviewLisaSegment('That sounds difficult. Would you like to tell me more?', low).decision, 'ALLOW');
  assert.equal(reviewLisaSegment('That sounds difficult.', { level: 'UNKNOWN', action: 'clarify_safety' }).decision, 'BLOCK');
});

test('TTS language is chosen per turn: Devanagari or Roman Hindi is hi, plain English is en', async () => {
  const { turnLanguage, URGENT_SUPPORT, isFixedPolicyText } = await import('./policy');
  assert.equal(turnLanguage('मुझे नींद नहीं आ रही'), 'hi');
  assert.equal(turnLanguage('mujhe exams ka stress hai'), 'hi');
  assert.equal(turnLanguage('I feel stressed about my exams and tension at home'), 'en');
  for (const text of [URGENT_SUPPORT.en, URGENT_SUPPORT.hi]) {
    assert.match(text, /14416/);
    assert.match(text, /112/);
    assert.equal(isFixedPolicyText(text), true);
  }
});
