import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Backdrop } from '@/components/z/backdrop';
import { PressScale } from '@/components/z/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZFont, ZRadius, ZShadow } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import { listContactNotifications, type ContactNotification } from '@/lib/contacts-api';

const STATUS: Record<ContactNotification['status'], string> = { QUEUED: 'Sending', SENT: 'Sent', FAILED: 'Could not be delivered' };

export default function ContactLogScreen() {
  const router = useRouter();
  const [items, setItems] = useState<ContactNotification[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getAuthSession()?.session.token;
    if (!token) { router.replace('/login'); return; }
    listContactNotifications(token).then(setItems).catch(e => setError(e instanceof Error ? e.message : 'Could not load the log.'));
  }, [router]);

  return <View style={{ flex: 1 }}><Backdrop /><SafeAreaView style={styles.root}>
    <View style={styles.header}>
      <PressScale onPress={() => router.back()} accessibilityLabel="Back"><MaterialIcons name="arrow-back" size={26} color={ZColors.forest} /></PressScale>
      <Text style={styles.title}>Messages sent</Text>
      <View style={{ width: 26 }} />
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Everything Zindagi has sent to someone you trust, word for word. Nothing is ever sent unless you tap send.</Text>
      {!items && !error && <ActivityIndicator color={ZColors.olive} />}
      {items?.length === 0 && <Text style={styles.empty}>Nothing has been sent.</Text>}
      {items?.map(n => <View key={n.id} style={styles.card}>
        <Text style={styles.who}>{n.contactLabel}</Text>
        <Text style={styles.meta}>{new Date(n.createdAt).toLocaleString()} · {n.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'} · {STATUS[n.status]}</Text>
        <Text style={styles.body}>{n.body}</Text>
      </View>)}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  </SafeAreaView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  title: { color: ZColors.textPrimary, fontSize: 20, fontFamily: ZFont.bold },
  content: { padding: 20, paddingTop: 0, gap: 14 },
  intro: { color: ZColors.textSecondary, fontFamily: ZFont.regular, fontSize: 14, lineHeight: 21 },
  empty: { color: ZColors.textMuted, fontFamily: ZFont.regular, fontSize: 15, textAlign: 'center', marginTop: 24 },
  card: { backgroundColor: '#fff', borderRadius: ZRadius.cardLg, padding: 16, gap: 6, ...ZShadow.lifted },
  who: { color: ZColors.textPrimary, fontSize: 16, fontFamily: ZFont.bold },
  meta: { color: ZColors.textMuted, fontFamily: ZFont.regular, fontSize: 12 },
  body: { color: ZColors.textPrimary, fontFamily: ZFont.regular, fontSize: 14, lineHeight: 21, marginTop: 4 },
  error: { color: ZColors.coralDeep, textAlign: 'center' },
});
