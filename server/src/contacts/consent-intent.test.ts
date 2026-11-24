import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConsent, matchContact, type OfferContact } from './consent-intent';

const PRIYA: OfferContact = { id: 'c1', name: 'Priya Sharma', relationship: 'SIBLING' };
const ROHAN: OfferContact = { id: 'c2', name: 'Rohan', relationship: 'FRIEND' };
const MOM: OfferContact = { id: 'c3', name: 'Sunita', relationship: 'FAMILY' };
const ALL = [PRIYA, ROHAN, MOM];
const intent = (text: string, contacts = ALL) => classifyConsent(text, contacts);

test('consent intent: a short yes is an accept, in English, Hinglish and Hindi', () => {
  for (const text of ['Yes', 'yeah please', 'okay', 'haan', 'Haan ji', 'theek hai', 'हाँ', 'जी', 'ठीक है']) {
    assert.equal(intent(text).intent, 'accept', text);
  }
});

test('consent intent: an explicit action picks message or call', () => {
  assert.deepEqual(intent('yes message my sister'), { intent: 'message', contactId: 'c1' });
  assert.deepEqual(intent('please text Rohan'), { intent: 'message', contactId: 'c2' });
  assert.deepEqual(intent('call mummy'), { intent: 'call', contactId: 'c3' });
  assert.deepEqual(intent('priya ko msg bhej do'), { intent: 'message', contactId: 'c1' });
  assert.deepEqual(intent('haan didi ko call kar do'), { intent: 'call', contactId: 'c1' });
  assert.equal(intent('मम्मी को फोन कर दो').intent, 'call');
  assert.deepEqual(intent('whatsapp'), { intent: 'message' });
});

test('consent intent: no, not now and negated actions are declines', () => {
  for (const text of ['no', 'nahi', 'not now', 'abhi nahi', 'नहीं', 'rehne do', "don't message her", 'please do not call my mom', 'call mat karo']) {
    assert.equal(intent(text).intent, 'decline', text);
  }
});

test('consent intent: unclear or unrelated speech changes nothing', () => {
  for (const text of [
    '', 'hmm', 'I want to tell you something about my exam',
    'yes I was really stressed about the exam last week and nobody understood what I was going through',
    'no, call her', 'my mom called me yesterday and we fought', 'I am fine', 'haha',
  ]) {
    assert.equal(intent(text).intent, 'none', text);
  }
});

test('consent intent: naming a person alone is an accept for that person', () => {
  assert.deepEqual(intent('my sister'), { intent: 'accept', contactId: 'c1' });
  assert.deepEqual(intent('Rohan'), { intent: 'accept', contactId: 'c2' });
});

test('consent intent: a contact is matched only when exactly one fits', () => {
  const twoFriends: OfferContact[] = [ROHAN, { id: 'c4', name: 'Aman', relationship: 'FRIEND' }];
  assert.equal(matchContact('message my friend', twoFriends), undefined);
  assert.equal(matchContact('message aman', twoFriends), 'c4');
  assert.equal(matchContact('message my sister', []), undefined);
  // A name inside another word is not a match.
  assert.equal(matchContact('rohanpreet', [ROHAN]), undefined);
});
