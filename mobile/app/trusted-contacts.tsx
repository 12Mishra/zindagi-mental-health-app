import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius, ZShadow } from '@/constants/zindagi-theme';
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

  return <SafeAreaView style={styles.root}>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back"><MaterialIcons name="arrow-back" size={26} color={ZColors.forest} /></TouchableOpacity>
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
          {RELATIONSHIPS.map(r => <TouchableOpacity key={r} style={[styles.chip, draft.relationship === r && styles.chipOn]} onPress={() => setDraft({ ...draft, relationship: r })}>
            <Text style={[styles.chipText, draft.relationship === r && styles.chipTextOn]}>{RELATIONSHIP_LABEL[r]}</Text>
          </TouchableOpacity>)}
        </View>
        <Text style={styles.label}>Send messages by</Text>
        <View style={styles.chips}>
          {(['WHATSAPP', 'SMS'] as const).map(c => <TouchableOpacity key={c} style={[styles.chip, draft.channel === c && styles.chipOn]} onPress={() => setDraft({ ...draft, channel: c })}>
            <Text style={[styles.chipText, draft.channel === c && styles.chipTextOn]}>{c === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}</Text>
          </TouchableOpacity>)}
        </View>
        <TouchableOpacity style={styles.primary} disabled={saving} onPress={() => void save()}><Text style={styles.primaryText}>{saving ? 'Saving...' : 'Save'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.ghost} onPress={() => { setDraft(null); setError(''); }}><Text style={styles.ghostText}>Cancel</Text></TouchableOpacity>
      </View> : <>
        {(intro || contacts.length === 0) && <View style={styles.explainer}>
          <MaterialIcons name="favorite-border" size={24} color={ZColors.olive} />
          <Text style={styles.explainerText}>{EXPLAINER}</Text>
          {intro && <TouchableOpacity onPress={() => { explainerSeen = true; setIntro(false); }}><Text style={styles.link}>Got it</Text></TouchableOpacity>}
        </View>}
        {contacts.map((c, i) => <View key={c.id} style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.meta}>{RELATIONSHIP_LABEL[c.relationship]} · {c.phoneMasked} · {c.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}</Text>
              <Text style={styles.meta}>{i === 0 ? 'Offered first' : `Offered ${i === 1 ? 'second' : 'third'}`}</Text>
            </View>
            <View style={styles.arrows}>
              <TouchableOpacity disabled={saving || i === 0} onPress={() => void move(i, -1)} accessibilityLabel={`Move ${c.name} up`}>
                <MaterialIcons name="keyboard-arrow-up" size={28} color={i === 0 ? ZColors.sage : ZColors.forest} />
              </TouchableOpacity>
              <TouchableOpacity disabled={saving || i === contacts.length - 1} onPress={() => void move(i, 1)} accessibilityLabel={`Move ${c.name} down`}>
                <MaterialIcons name="keyboard-arrow-down" size={28} color={i === contacts.length - 1 ? ZColors.sage : ZColors.forest} />
              </TouchableOpacity>
            </View>
          </View>
          {confirmId === c.id ? <View style={styles.confirm}>
            <Text style={styles.confirmText}>Delete {c.name}? Their name and number are erased for good.</Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.danger} disabled={saving} onPress={() => void remove(c.id)}><Text style={styles.dangerText}>Delete</Text></TouchableOpacity>
              <TouchableOpacity style={styles.ghost} onPress={() => setConfirmId(null)}><Text style={styles.ghostText}>Keep</Text></TouchableOpacity>
            </View>
          </View> : <View style={styles.row}>
            <TouchableOpacity onPress={() => setDraft({ id: c.id, name: c.name, phone: '', relationship: c.relationship, channel: c.channel })}><Text style={styles.link}>Edit</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setConfirmId(c.id)}><Text style={[styles.link, { color: ZColors.coralDeep }]}>Delete</Text></TouchableOpacity>
          </View>}
        </View>)}
        {contacts.length < MAX && <TouchableOpacity style={styles.primary} onPress={startAdd}><Text style={styles.primaryText}>Add someone you trust</Text></TouchableOpacity>}
        {contacts.length >= MAX && <Text style={styles.meta}>You have added the most people you can (3).</Text>}
        <TouchableOpacity style={styles.ghost} onPress={() => router.push('/contact-log' as Href)}><Text style={styles.ghostText}>See messages sent on your behalf</Text></TouchableOpacity>
      </>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ZColors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  title: { color: ZColors.textPrimary, fontSize: 20, fontWeight: '700' },
  content: { padding: 20, paddingTop: 0, gap: 14 },
  explainer: { backgroundColor: ZColors.sageLight, borderRadius: ZRadius.card, padding: 16, gap: 10 },
  explainerText: { color: ZColors.forest, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: '#fff', borderRadius: ZRadius.card, padding: 16, gap: 10, ...ZShadow.card },
  cardTitle: { color: ZColors.textPrimary, fontSize: 17, fontWeight: '700' },
  meta: { color: ZColors.textMuted, fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  arrows: { alignItems: 'center' },
  label: { color: ZColors.textSecondary, fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: ZColors.cream, borderRadius: ZRadius.small, padding: 12, fontSize: 16, color: ZColors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: ZRadius.pill, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: ZColors.creamCard },
  chipOn: { backgroundColor: ZColors.forest },
  chipText: { color: ZColors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  primary: { backgroundColor: ZColors.olive, borderRadius: ZRadius.pill, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: { paddingVertical: 10, alignItems: 'center' },
  ghostText: { color: ZColors.textSecondary, fontWeight: '600' },
  link: { color: ZColors.olive, fontWeight: '700', fontSize: 14 },
  confirm: { backgroundColor: ZColors.coralLight, borderRadius: ZRadius.small, padding: 12, gap: 8 },
  confirmText: { color: ZColors.textPrimary, fontSize: 14 },
  danger: { backgroundColor: ZColors.coralDeep, borderRadius: ZRadius.pill, paddingHorizontal: 20, paddingVertical: 10 },
  dangerText: { color: '#fff', fontWeight: '700' },
  error: { color: ZColors.coralDeep, fontSize: 14, textAlign: 'center' },
});
