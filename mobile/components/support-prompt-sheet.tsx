import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PressScale } from '@/components/z/press';
import { ZColors, ZFont, ZRadius, ZShadow } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import {
  getPendingPrompt, listContacts, previewMessage, respondToPrompt, type Contact, type MessageLang, type PendingPrompt,
} from '@/lib/contacts-api';
import { isSupportPromptDismissed, onSupportPromptCheck, type PromptHint } from '@/lib/support-prompt-store';

type Step = 'choose' | 'preview' | 'sent';

/**
 * The consent-first prompt. Nothing is sent to anyone until the student taps "Send" on the preview step.
 * Mounted once at the root; it checks for a pending prompt when the app comes to the foreground or when asked to.
 */
export function SupportPromptHost() {
  const router = useRouter();
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState(0);
  const [showOthers, setShowOthers] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [lang, setLang] = useState<MessageLang>('en');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checking = useRef(false);

  const openPreview = useCallback(async (language: MessageLang) => {
    const token = getAuthSession()?.session.token;
    if (!token) return;
    setBusy(true); setError('');
    try { const { text } = await previewMessage(token, language); setPreview(text); setLang(language); setStep('preview'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the message.'); }
    finally { setBusy(false); }
  }, []);

  // A spoken "yes, message Priya" picks Priya and, for a message, goes straight to the preview. The Send tap is still theirs.
  const applyHint = useCallback((list: Contact[], hint?: PromptHint) => {
    const found = hint?.contactId ? list.findIndex(c => c.id === hint.contactId) : -1;
    const index = found >= 0 ? found : 0;
    setSelected(index); setShowOthers(false);
    if (hint?.intent === 'message' && list[index]) void openPreview(lang);
  }, [lang, openPreview]);

  const check = useCallback(async (hint?: PromptHint) => {
    const token = getAuthSession()?.session.token;
    if (prompt) { if (hint && step === 'choose') applyHint(contacts, hint); return; }
    if (!token || checking.current) return;
    checking.current = true;
    try {
      const pending = await getPendingPrompt(token);
      if (!pending || (!hint && isSupportPromptDismissed(pending.id))) return;
      const list = await listContacts(token).catch(() => []);
      setContacts(list);
      setStep('choose'); setError(''); setPrompt(pending);
      applyHint(list, hint);
    } catch { /* offline or signed out: try again next time */ }
    finally { checking.current = false; }
  }, [prompt, contacts, step, applyHint]);

  useEffect(() => {
    // Deferred a tick so the first check's state updates land outside the effect body.
    void Promise.resolve().then(() => check());
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    const unsubscribe = onSupportPromptCheck(hint => { void check(hint); });
    return () => { subscription.remove(); unsubscribe(); };
  }, [check]);

  const close = () => { setPrompt(null); setStep('choose'); setPreview(''); setBusy(false); };
  const respond = async (body: Parameters<typeof respondToPrompt>[2]) => {
    const token = getAuthSession()?.session.token;
    if (!token || !prompt) return null;
    setBusy(true); setError('');
    try { return await respondToPrompt(token, prompt.id, body); }
    catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      setError(message);
      // Expired or already answered: nothing left to do here.
      if (/expired|already answered/i.test(message)) setTimeout(close, 1500);
      return null;
    } finally { setBusy(false); }
  };

  const contact = contacts[selected];
  const soft = prompt?.level === 'LOW';
  const callCrisis = (number: string) => { void Linking.openURL(`tel:${number}`); };

  const decline = async () => { if (await respond({ action: 'decline' })) close(); };
  const call = async () => {
    if (!contact) return;
    const result = await respond({ action: 'call', contactId: contact.id });
    if (result?.tel) void Linking.openURL(`tel:${result.tel}`);
    if (result) close();
  };
  const send = async () => {
    if (!contact) return;
    if (await respond({ action: 'message', contactId: contact.id, lang })) setStep('sent');
  };
  const goTo = (href: string) => { close(); router.push(href as Href); };

  if (!prompt) return null;

  return <Modal visible transparent animationType="slide" onRequestClose={() => { void decline(); }}>
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'sent' ? <>
            <Text style={styles.title}>Message queued</Text>
            <Text style={styles.body}>{contact?.name} will get a short check-in request. It says nothing about what you shared. You can see exactly what was sent in your message log.</Text>
            <PressScale style={styles.primary} onPress={() => goTo('/contact-log')}><Text style={styles.primaryText}>See message log</Text></PressScale>
            <PressScale style={styles.ghost} onPress={close}><Text style={styles.ghostText}>Close</Text></PressScale>
          </> : step === 'preview' && contact ? <>
            <Text style={styles.title}>This is exactly what {contact.name} will receive</Text>
            <View style={styles.previewBox}><Text style={styles.previewText}>{preview}</Text></View>
            <Text style={styles.small}>Sent by {contact.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}. It does not include anything you said to Lisa.</Text>
            <View style={styles.langRow}>
              {(['en', 'hi'] as const).map(l => <PressScale key={l} style={[styles.chip, lang === l && styles.chipOn]} disabled={busy} onPress={() => void openPreview(l)}>
                <Text style={[styles.chipText, lang === l && styles.chipTextOn]}>{l === 'en' ? 'English' : 'हिन्दी'}</Text>
              </PressScale>)}
            </View>
            <PressScale style={styles.primary} disabled={busy} onPress={() => void send()}>
              <Text style={styles.primaryText}>Send to {contact.name}</Text>
            </PressScale>
            <PressScale style={styles.ghost} disabled={busy} onPress={() => setStep('choose')}><Text style={styles.ghostText}>Back</Text></PressScale>
          </> : contact ? <>
            <Text style={styles.title}>{soft ? `It's been a hard few days. Would you like to reach out to ${contact.name}?` : `Would you like to talk to ${contact.name}?`}</Text>
            <PressScale style={styles.primary} disabled={busy} onPress={() => void call()}><Text style={styles.primaryText}>Call {contact.name}</Text></PressScale>
            <PressScale style={styles.secondary} disabled={busy} onPress={() => void openPreview(lang)}>
              <Text style={styles.secondaryText}>Send {contact.name} a check-in message</Text>
            </PressScale>
            {contacts.length > 1 && <PressScale onPress={() => setShowOthers(!showOthers)}>
              <Text style={styles.link}>Someone else {showOthers ? '▴' : '▾'}</Text>
            </PressScale>}
            {showOthers && contacts.map((c, i) => i === selected ? null : <PressScale key={c.id} style={styles.other} onPress={() => { setSelected(i); setShowOthers(false); }}>
              <Text style={styles.otherText}>{c.name}</Text>
            </PressScale>)}
            <PressScale style={styles.ghost} disabled={busy} onPress={() => void decline()}><Text style={styles.ghostText}>Not now</Text></PressScale>
          </> : <>
            <Text style={styles.title}>{soft ? 'It looks like things have been hard lately.' : 'You do not have to go through this alone.'}</Text>
            <Text style={styles.body}>Talking to someone can help. You can call Tele-MANAS any time, free and confidential.</Text>
            <PressScale style={styles.primary} onPress={() => callCrisis('14416')}><Text style={styles.primaryText}>Call Tele-MANAS 14416</Text></PressScale>
            <PressScale style={styles.secondary} onPress={() => goTo('/trusted-contacts')}><Text style={styles.secondaryText}>Add someone you trust</Text></PressScale>
            <PressScale style={styles.ghost} disabled={busy} onPress={() => void decline()}><Text style={styles.ghostText}>Not now</Text></PressScale>
          </>}
          {!!error && <Text style={styles.error}>{error}</Text>}
          {busy && <ActivityIndicator color={ZColors.olive} />}
          {step !== 'sent' && <Text style={styles.crisis}>
            Need help right now? <Text style={styles.crisisLink} onPress={() => callCrisis('14416')}>Tele-MANAS 14416</Text> · <Text style={styles.crisisLink} onPress={() => callCrisis('112')}>Emergency 112</Text>
          </Text>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: 'rgba(255,255,255,0.7)', borderTopLeftRadius: ZRadius.cardLg, borderTopRightRadius: ZRadius.cardLg, maxHeight: '88%' },
  content: { padding: 24, paddingBottom: 36, gap: 12 },
  title: { color: ZColors.textPrimary, fontSize: 21, fontFamily: ZFont.bold, lineHeight: 28 },
  body: { color: ZColors.textSecondary, fontFamily: ZFont.regular, fontSize: 15, lineHeight: 22 },
  small: { color: ZColors.textMuted, fontFamily: ZFont.regular, fontSize: 12, lineHeight: 17 },
  primary: { backgroundColor: ZColors.olive, borderRadius: 20, paddingVertical: 16, alignItems: 'center', paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'center', gap: 8, borderTopWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.35)', ...ZShadow.glow },
  primaryText: { color: '#fff', fontFamily: ZFont.bold, fontSize: 16 },
  secondary: { borderRadius: 18, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.88)', borderWidth: 1, borderColor: '#FFFFFF', ...ZShadow.lifted },
  secondaryText: { color: ZColors.forest, fontFamily: ZFont.bold, fontSize: 15 },
  ghost: { paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: ZColors.textSecondary, fontFamily: ZFont.semibold, fontSize: 15 },
  link: { color: ZColors.olive, fontFamily: ZFont.semibold, textAlign: 'center', paddingVertical: 4 },
  other: { backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: ZRadius.small, padding: 14 },
  otherText: { color: ZColors.textPrimary, fontFamily: ZFont.regular, fontSize: 15 },
  previewBox: { backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: ZRadius.small, padding: 14 },
  previewText: { color: ZColors.textPrimary, fontFamily: ZFont.regular, fontSize: 15, lineHeight: 22 },
  langRow: { flexDirection: 'row', gap: 8 },
  chip: { borderRadius: ZRadius.pill, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: '#FFFFFF' },
  chipOn: { backgroundColor: ZColors.forest },
  chipText: { color: ZColors.textSecondary, fontFamily: ZFont.semibold },
  chipTextOn: { color: '#fff' },
  error: { color: ZColors.coralDeep, fontFamily: ZFont.regular, fontSize: 13 },
  crisis: { color: ZColors.textMuted, fontFamily: ZFont.regular, fontSize: 13, textAlign: 'center', marginTop: 8 },
  crisisLink: { color: ZColors.forest, fontFamily: ZFont.bold },
});
