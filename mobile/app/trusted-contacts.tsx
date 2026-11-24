import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Backdrop } from '@/components/z/backdrop';
import { PressScale } from '@/components/z/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZFont, ZRadius, ZShadow } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import {
  addContact, deleteContact, listContacts, RELATIONSHIPS, RELATIONSHIP_LABEL, reorderContacts, updateContact,
  type Channel, type Contact, type Relationship,
} from '@/lib/contacts-api';

const MAX = 3;
const EXPLAINER = "Add up to 3 people you trust. If you're having a hard time, Zindagi may ask whether you'd like to reach one of them. We never contact anyone unless you say yes, and they only get a short request to check on you, never what you talked about.";

// Remembered for this app session; the card also shows whenever the list is empty.
let explainerSeen = false;

type Draft = { id: string | null; name: string; phone: string; relationship: Relationship | null; channel: Channel };
const emptyDraft: Draft = { id: null, name: '', phone: '', relationship: null, channel: 'WHATSAPP' };

export default function TrustedContactsScreen() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [intro, setIntro] = useState(!explainerSeen);
  const token = getAuthSession()?.session.token;

  const load = useCallback(async () => {
    if (!token) { router.replace('/login'); return; }
    try { setContacts(await listContacts(token)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your contacts.'); }
    finally { setLoading(false); }
  }, [token, router]);
  useEffect(() => { void load(); }, [load]);

  const guard = async (work: () => Promise<void>) => {
    setSaving(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setSaving(false); }
  };

  const move = (index: number, delta: -1 | 1) => guard(async () => {
    const ids = contacts.map(c => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length || !token) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setContacts(await reorderContacts(token, ids));
  });

  const save = () => guard(async () => {
    if (!token || !draft) return;
    if (!draft.name.trim()) throw new Error('Add their name.');
    if (!draft.relationship) throw new Error('Choose who this person is to you.');
    if (draft.id) await updateContact(token, draft.id, { name: draft.name.trim(), relationship: draft.relationship, channel: draft.channel });
    else await addContact(token, { name: draft.name.trim(), phone: draft.phone, relationship: draft.relationship, channel: draft.channel });
    setDraft(null);
    await load();
  });

  const remove = (id: string) => guard(async () => {
    if (!token) return;
    await deleteContact(token, id);
    setConfirmId(null);
    await load();
  });

  const startAdd = () => { explainerSeen = true; setIntro(false); setDraft({ ...emptyDraft }); };

  return <View style={{ flex: 1 }}><Backdrop /><SafeAreaView style={styles.root}>
    <View style={styles.header}>
      <PressScale onPress={() => router.back()} accessibilityLabel="Back"><MaterialIcons name="arrow-back" size={26} color={ZColors.forest} /></PressScale>
      <Text style={styles.title}>People I trust</Text>
      <View style={{ width: 26 }} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color={ZColors.olive} /> : draft ? <View style={styles.card}>
        <Text style={styles.cardTitle}>{draft.id ? 'Edit' : 'Add someone you trust'}</Text>
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={draft.name} onChangeText={name => setDraft({ ...draft, name })} placeholder="Their name" maxLength={40} />
        {!draft.id && <>
          <Text style={styles.label}>Phone number (India)</Text>
          <TextInput style={styles.input} value={draft.phone} onChangeText={phone => setDraft({ ...draft, phone })} placeholder="98765 43210" keyboardType="phone-pad" maxLength={16} />
        </>}
        <Text style={styles.label}>Who are they to you?</Text>
        <View style={styles.chips}>
          {RELATIONSHIPS.map(r => <PressScale key={r} style={[styles.chip, draft.relationship === r && styles.chipOn]} onPress={() => setDraft({ ...draft, relationship: r })}>
            <Text style={[styles.chipText, draft.relationship === r && styles.chipTextOn]}>{RELATIONSHIP_LABEL[r]}</Text>
          </PressScale>)}
        </View>
        <Text style={styles.label}>Send messages by</Text>
        <View style={styles.chips}>
          {(['WHATSAPP', 'SMS'] as const).map(c => <PressScale key={c} style={[styles.chip, draft.channel === c && styles.chipOn]} onPress={() => setDraft({ ...draft, channel: c })}>
            <Text style={[styles.chipText, draft.channel === c && styles.chipTextOn]}>{c === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}</Text>
          </PressScale>)}
        </View>
        <PressScale style={styles.primary} disabled={saving} onPress={() => void save()}><Text style={styles.primaryText}>{saving ? 'Saving...' : 'Save'}</Text></PressScale>
        <PressScale style={styles.ghost} onPress={() => { setDraft(null); setError(''); }}><Text style={styles.ghostText}>Cancel</Text></PressScale>
      </View> : <>
        {(intro || contacts.length === 0) && <View style={styles.explainer}>
          <MaterialIcons name="favorite-border" size={24} color={ZColors.olive} />
          <Text style={styles.explainerText}>{EXPLAINER}</Text>
          {intro && <PressScale onPress={() => { explainerSeen = true; setIntro(false); }}><Text style={styles.link}>Got it</Text></PressScale>}
        </View>}
        {contacts.map((c, i) => <View key={c.id} style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.meta}>{RELATIONSHIP_LABEL[c.relationship]} · {c.phoneMasked} · {c.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}</Text>
              <Text style={styles.meta}>{i === 0 ? 'Offered first' : `Offered ${i === 1 ? 'second' : 'third'}`}</Text>
            </View>
            <View style={styles.arrows}>
              <PressScale disabled={saving || i === 0} onPress={() => void move(i, -1)} accessibilityLabel={`Move ${c.name} up`}>
                <MaterialIcons name="keyboard-arrow-up" size={28} color={i === 0 ? ZColors.sage : ZColors.forest} />
              </PressScale>
              <PressScale disabled={saving || i === contacts.length - 1} onPress={() => void move(i, 1)} accessibilityLabel={`Move ${c.name} down`}>
                <MaterialIcons name="keyboard-arrow-down" size={28} color={i === contacts.length - 1 ? ZColors.sage : ZColors.forest} />
              </PressScale>
            </View>
          </View>
          {confirmId === c.id ? <View style={styles.confirm}>
            <Text style={styles.confirmText}>Delete {c.name}? Their name and number are erased for good.</Text>
            <View style={styles.row}>
              <PressScale style={styles.danger} disabled={saving} onPress={() => void remove(c.id)}><Text style={styles.dangerText}>Delete</Text></PressScale>
              <PressScale style={styles.ghost} onPress={() => setConfirmId(null)}><Text style={styles.ghostText}>Keep</Text></PressScale>
            </View>
          </View> : <View style={styles.row}>
            <PressScale onPress={() => setDraft({ id: c.id, name: c.name, phone: '', relationship: c.relationship, channel: c.channel })}><Text style={styles.link}>Edit</Text></PressScale>
            <PressScale onPress={() => setConfirmId(c.id)}><Text style={[styles.link, { color: ZColors.coralDeep }]}>Delete</Text></PressScale>
          </View>}
        </View>)}
        {contacts.length < MAX && <PressScale style={styles.primary} onPress={startAdd}><Text style={styles.primaryText}>Add someone you trust</Text></PressScale>}
        {contacts.length >= MAX && <Text style={styles.meta}>You have added the most people you can (3).</Text>}
        <PressScale style={styles.ghost} onPress={() => router.push('/contact-log' as Href)}><Text style={styles.ghostText}>See messages sent on your behalf</Text></PressScale>
      </>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  </SafeAreaView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  title: { color: ZColors.textPrimary, fontSize: 20, fontFamily: ZFont.bold },
  content: { padding: 20, paddingTop: 0, gap: 14 },
  explainer: { backgroundColor: ZColors.sageLight, borderRadius: ZRadius.cardLg, padding: 16, gap: 10 },
  explainerText: { color: ZColors.forest, fontFamily: ZFont.regular, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: '#fff', borderRadius: ZRadius.cardLg, padding: 16, gap: 10, ...ZShadow.lifted },
  cardTitle: { color: ZColors.textPrimary, fontSize: 17, fontFamily: ZFont.bold },
  meta: { color: ZColors.textMuted, fontFamily: ZFont.regular, fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  arrows: { alignItems: 'center' },
  label: { color: ZColors.textSecondary, fontSize: 13, fontFamily: ZFont.semibold },
  input: { backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: ZRadius.small, padding: 12, fontFamily: ZFont.regular, fontSize: 16, color: ZColors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: ZRadius.pill, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: '#FFFFFF' },
  chipOn: { backgroundColor: ZColors.forest },
  chipText: { color: ZColors.textSecondary, fontFamily: ZFont.semibold },
  chipTextOn: { color: '#fff' },
  primary: { backgroundColor: ZColors.olive, borderRadius: 20, paddingVertical: 16, alignItems: 'center', paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'center', gap: 8, borderTopWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.35)', ...ZShadow.glow },
  primaryText: { color: '#fff', fontFamily: ZFont.bold, fontSize: 16 },
  ghost: { paddingVertical: 10, alignItems: 'center' },
  ghostText: { color: ZColors.textSecondary, fontFamily: ZFont.semibold },
  link: { color: ZColors.olive, fontFamily: ZFont.bold, fontSize: 14 },
  confirm: { backgroundColor: ZColors.coralLight, borderRadius: ZRadius.small, padding: 12, gap: 8 },
  confirmText: { color: ZColors.textPrimary, fontFamily: ZFont.regular, fontSize: 14 },
  danger: { backgroundColor: ZColors.coralDeep, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 11, borderTopWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.35)', ...ZShadow.subtle },
  dangerText: { color: '#fff', fontFamily: ZFont.bold },
  error: { color: ZColors.coralDeep, fontFamily: ZFont.regular, fontSize: 14, textAlign: 'center' },
});
