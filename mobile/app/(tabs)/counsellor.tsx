import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius, ZShadow } from '@/constants/zindagi-theme';
import { getAuthSession } from '@/lib/auth-session';
import { fmtMsgTime, listChatContacts, listChatThreads, openChatThread, useChatEvents, type ChatContact, type ChatThread } from '@/lib/chat-api';
import {
  acceptProposal, cancelAppointment, cancelRequest, createRequest, FIRST_HOUR, fmtDateNum, fmtDay, fmtHour, fmtSlot, fmtTime,
  fmtWeekday, getAvailability, hourStart, LAST_START_HOUR, listAppointments, listRequests, MODE_LABEL, offerNewTimes, officeDays,
  type Appointment, type Availability, type OpenSlot, type SessionMode, type SessionRequest,
} from '@/lib/counselling-api';

const PRIVACY = "You don't need to explain what's going on here. Counsellors only see your roll number, branch and the times you pick. You'll talk about the rest in person.";
const MAX_TIMES = 12;
const HOURS = Array.from({ length: LAST_START_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

type View_ = 'home' | 'form' | 'retime';

export default function CounsellorScreen() {
  const router = useRouter();
  const token = getAuthSession()?.session.token;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [requests, setRequests] = useState<SessionRequest[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [contacts, setContacts] = useState<ChatContact[]>([]);

  const [view, setView] = useState<View_>('home');
  const [rollNumber, setRollNumber] = useState('');
  const [branch, setBranch] = useState('');
  const [therapistId, setTherapistId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>('IN_PERSON');
  const [dayIdx, setDayIdx] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [booking, setBooking] = useState<OpenSlot | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  // Snapshot of the clock, refreshed on every load, so render stays pure.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!token) { router.replace('/login'); return; }
    try {
      const [av, rq, ap, th, ct] = await Promise.all([
        getAvailability(token), listRequests(token), listAppointments(token), listChatThreads(token), listChatContacts(token),
      ]);
      setThreads(th); setContacts(ct);
      setAvailability(av); setRequests(rq); setAppointments(ap); setError(''); setNow(Date.now());
      // Prefill the form from the last request, like a browser remembers a form.
      const last = rq[0];
      if (last) { setRollNumber(r => r || last.rollNumber); setBranch(b => b || last.branch); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load counselling.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [token, router]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const days = useMemo(() => officeDays(10, now), [now]);

  // Keep the Messages section live: a new message or a counsellor starting a chat refreshes the list.
  useChatEvents(e => {
    if ((e.type === 'message' || e.type === 'thread') && token) {
      void listChatThreads(token).then(setThreads).catch(() => {});
      if (e.type === 'thread') void listChatContacts(token).then(setContacts).catch(() => {});
    }
  });

  const openChat = (therapistId: string) => run(async () => {
    if (!token) return;
    const existing = contacts.find(c => c.therapistId === therapistId)?.threadId;
    const threadId = existing ?? (await openChatThread(token, therapistId)).threadId;
    router.push(`/chat/${threadId}` as never);
  });
  const contactByName = (name: string) => contacts.find(c => c.name === name);
  const openRequest = requests.find(r => r.status === 'PENDING' || r.status === 'PROPOSED') ?? null;
  const upcoming = appointments.filter(a => a.status === 'CONFIRMED' && new Date(a.endsAt).getTime() > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  // Show a recently closed request so a decline note is not missed.
  const recentClosed = requests.find(r => (r.status === 'DECLINED' || r.status === 'EXPIRED') && now - new Date(r.updatedAt).getTime() < 7 * 86_400_000
    && (!openRequest || r.updatedAt > openRequest.createdAt));
  const counsellorName = (id: string | null) => availability?.counsellors.find(c => c.id === id)?.name;

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const startForm = () => { setPicked([]); setBooking(null); setDayIdx(0); setView('form'); };
  const startRetime = () => { setPicked([]); setBooking(null); setDayIdx(0); setView('retime'); };
  const back = () => { setView('home'); setBooking(null); setError(''); };

  const togglePick = (iso: string) => setPicked(p => {
    if (p.includes(iso)) return p.filter(x => x !== iso);
    if (p.length >= MAX_TIMES) { setError(`You can choose up to ${MAX_TIMES} times.`); return p; }
    return [...p, iso].sort();
  });

  const detailsError = () => {
    if (!/^[A-Za-z0-9/-]{3,20}$/.test(rollNumber.trim())) return 'Enter your roll number.';
    if (branch.trim().length < 2) return 'Enter your branch.';
    return null;
  };

  const sendRequest = () => run(async () => {
    if (!token) return;
    const problem = detailsError();
    if (problem) throw new Error(problem);
    if (!picked.length) throw new Error('Choose at least one time that works for you.');
    await createRequest(token, { rollNumber: rollNumber.trim(), branch: branch.trim(), mode, therapistId, windows: picked });
    setView('home');
    setNotice(therapistId ? `Request sent to ${counsellorName(therapistId)}.` : 'Request sent to the counselling cell.');
    await load();
  });

  const bookNow = (slot: OpenSlot) => run(async () => {
    if (!token) return;
    const problem = detailsError();
    if (problem) { setBooking(null); throw new Error(problem); }
    await createRequest(token, { rollNumber: rollNumber.trim(), branch: branch.trim(), mode, slotId: slot.id });
    setBooking(null); setView('home');
    setNotice(`Booked with ${counsellorName(slot.therapistId)} on ${fmtSlot(slot.startsAt)}.`);
    await load();
  });

  const sendNewTimes = () => run(async () => {
    if (!token || !openRequest) return;
    if (!picked.length) throw new Error('Choose at least one time that works for you.');
    await offerNewTimes(token, openRequest.id, picked);
    setView('home'); setNotice('New times sent.');
    await load();
  });

  const accept = (r: SessionRequest) => run(async () => {
    if (!token) return;
    await acceptProposal(token, r.id);
    setNotice(`Confirmed for ${fmtSlot(r.proposedStartsAt!)}.`);
    await load();
  });

  const withdraw = (r: SessionRequest) => run(async () => {
    if (!token) return;
    await cancelRequest(token, r.id); setConfirmCancel(null); setNotice('Request cancelled.');
    await load();
  });

  const cancelSession = (a: Appointment) => run(async () => {
    if (!token) return;
    await cancelAppointment(token, a.id); setConfirmCancel(null); setNotice('Session cancelled.');
    await load();
  });

  // ── Hour grid for the selected day ──
  const renderHours = (allowBooking: boolean) => {
    const day = days[dayIdx];
    if (day == null || !availability) return null;
    const who = view === 'retime' ? openRequest?.counsellor?.id ?? null : therapistId;
    return <View style={styles.hours}>
      {HOURS.map(h => {
        const iso = hourStart(day, h);
        const t = new Date(iso).getTime();
        const past = t <= now;
        const open = allowBooking
          ? availability.openSlots.find(s => s.startsAt === iso && (!who || s.therapistId === who))
          : undefined;
        const taken = !!who && availability.busy.some(b => b.therapistId === who && new Date(b.startsAt).getTime() < t + 3_600_000 && new Date(b.endsAt).getTime() > t);
        const on = picked.includes(iso);
        const disabled = past || (taken && !open);
        const label = past ? 'Passed' : open ? 'Open · book now' : taken ? 'Taken' : on ? 'You’re free' : 'Tap if free';
        return <TouchableOpacity key={h} disabled={disabled}
          style={[styles.hour, open && styles.hourOpen, on && styles.hourOn, disabled && styles.hourOff]}
          accessibilityRole="button" accessibilityState={{ selected: on, disabled }}
          accessibilityLabel={`${fmtDay(day)} ${fmtHour(h)}: ${label}`}
          onPress={() => (open ? setBooking(open) : togglePick(iso))}>
          <Text style={[styles.hourTime, on && styles.hourTextOn, disabled && styles.hourTextOff]}>{fmtHour(h)}</Text>
          <Text style={[styles.hourLabel, open && styles.hourLabelOpen, on && styles.hourTextOn, disabled && styles.hourTextOff]}>{label}</Text>
        </TouchableOpacity>;
      })}
    </View>;
  };

  const renderDayStrip = () => <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
    {days.map((d, i) => {
      const count = picked.filter(p => p >= hourStart(d, 0) && p < hourStart(d, 24)).length;
      return <TouchableOpacity key={d} style={[styles.day, i === dayIdx && styles.dayOn]} onPress={() => setDayIdx(i)}
        accessibilityLabel={`${fmtDay(d)}${count ? `, ${count} chosen` : ''}`}>
        <Text style={[styles.dayWd, i === dayIdx && styles.dayTextOn]}>{fmtWeekday(d)}</Text>
        <Text style={[styles.dayNum, i === dayIdx && styles.dayTextOn]}>{fmtDateNum(d)}</Text>
        {count > 0 && <View style={[styles.dot, i === dayIdx && { backgroundColor: '#fff' }]} />}
      </TouchableOpacity>;
    })}
  </ScrollView>;

  const renderPicked = () => picked.length > 0 && <View style={styles.chips}>
    {picked.map(p => <TouchableOpacity key={p} style={styles.pickedChip} onPress={() => togglePick(p)} accessibilityLabel={`Remove ${fmtSlot(p)}`}>
      <Text style={styles.pickedText}>{fmtDay(p)} · {fmtTime(p)}</Text>
      <MaterialIcons name="close" size={14} color={ZColors.forest} />
    </TouchableOpacity>)}
  </View>;

  const renderBookingConfirm = () => booking && <View style={styles.confirmCard}>
    <Text style={styles.cardTitle}>Book this session?</Text>
    <Text style={styles.body}>{counsellorName(booking.therapistId)} · {fmtSlot(booking.startsAt)} – {fmtTime(booking.endsAt)}</Text>
    <Text style={styles.meta}>{MODE_LABEL[mode]} · confirmed straight away</Text>
    <View style={styles.row}>
      <TouchableOpacity style={[styles.primary, { flex: 1 }]} disabled={busy} onPress={() => void bookNow(booking)}>
        <Text style={styles.primaryText}>{busy ? 'Booking…' : 'Book'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.ghost} onPress={() => setBooking(null)}><Text style={styles.ghostText}>Not this one</Text></TouchableOpacity>
    </View>
  </View>;

  // ── Screens ──

  const renderForm = () => <>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Your details</Text>
      <Text style={styles.label}>Roll number</Text>
      <TextInput style={styles.input} value={rollNumber} onChangeText={setRollNumber} placeholder="e.g. 102103456" autoCapitalize="characters" maxLength={20} />
      <Text style={styles.label}>Branch</Text>
      <TextInput style={styles.input} value={branch} onChangeText={setBranch} placeholder="e.g. Computer Engineering" maxLength={60} />
      <Text style={styles.label}>Counsellor</Text>
      <View style={styles.chips}>
        <Chip on={therapistId === null} label="Anyone available" onPress={() => setTherapistId(null)} />
        {availability?.counsellors.map(c => <Chip key={c.id} on={therapistId === c.id} label={c.name} onPress={() => setTherapistId(c.id)} />)}
      </View>
      <Text style={styles.label}>How would you like to meet?</Text>
      <View style={styles.chips}>
        {(['IN_PERSON', 'PHONE'] as const).map(m => <Chip key={m} on={mode === m} label={MODE_LABEL[m]} onPress={() => setMode(m)} />)}
      </View>
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>When can you make it?</Text>
      <Text style={styles.meta}>Green times are open now and book instantly. Otherwise, tap every hour you’re free and a counsellor will confirm one, or suggest another time.</Text>
      {renderDayStrip()}
      {renderHours(true)}
      {renderPicked()}
    </View>
    {renderBookingConfirm()}

    <View style={styles.explainer}><MaterialIcons name="lock-outline" size={18} color={ZColors.forest} /><Text style={styles.explainerText}>{PRIVACY}</Text></View>
    <TouchableOpacity style={[styles.primary, (!picked.length || busy) && styles.disabled]} disabled={!picked.length || busy} onPress={() => void sendRequest()}>
      <Text style={styles.primaryText}>{busy ? 'Sending…' : picked.length ? `Send request (${picked.length} ${picked.length === 1 ? 'time' : 'times'})` : 'Pick times to send a request'}</Text>
    </TouchableOpacity>
    <TouchableOpacity style={styles.ghost} onPress={back}><Text style={styles.ghostText}>Cancel</Text></TouchableOpacity>
  </>;

  const renderRetime = () => <>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Offer other times</Text>
      <Text style={styles.meta}>Tap every hour you’re free. {openRequest?.handledBy ?? 'The counsellor'} will pick one.</Text>
      {renderDayStrip()}
      {renderHours(false)}
      {renderPicked()}
    </View>
    <TouchableOpacity style={[styles.primary, (!picked.length || busy) && styles.disabled]} disabled={!picked.length || busy} onPress={() => void sendNewTimes()}>
      <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send new times'}</Text>
    </TouchableOpacity>
    <TouchableOpacity style={styles.ghost} onPress={back}><Text style={styles.ghostText}>Back</Text></TouchableOpacity>
  </>;

  const renderRequest = (r: SessionRequest) => {
    const to = r.counsellor?.name ?? 'the counselling cell';
    return <View style={styles.card}>
      <View style={styles.row}>
        <MaterialIcons name={r.status === 'PROPOSED' ? 'event-available' : 'schedule-send'} size={22} color={ZColors.olive} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>{r.status === 'PROPOSED' ? `${r.handledBy} suggested a time` : `Request sent to ${to}`}</Text>
      </View>
      {r.status === 'PROPOSED' && r.proposedStartsAt ? <>
        <Text style={styles.big}>{fmtSlot(r.proposedStartsAt)}</Text>
        <Text style={styles.meta}>{MODE_LABEL[r.mode]}{r.counsellorNote ? ` · ${r.counsellorNote}` : ''}</Text>
        <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void accept(r)}><Text style={styles.primaryText}>Accept this time</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondary} disabled={busy} onPress={startRetime}><Text style={styles.secondaryText}>That doesn’t work, offer other times</Text></TouchableOpacity>
      </> : <>
        <Text style={styles.meta}>A counsellor will confirm one of these, or suggest another time. You’ll see it here.</Text>
        <View style={styles.chips}>{r.windows.filter(w => new Date(w).getTime() > now).map(w =>
          <View key={w} style={styles.timeChip}><Text style={styles.timeChipText}>{fmtDay(w)} · {fmtTime(w)}</Text></View>)}
        </View>
        <Text style={styles.meta}>{MODE_LABEL[r.mode]} · Roll {r.rollNumber}</Text>
      </>}
      {confirmCancel === r.id ? <View style={styles.confirm}>
        <Text style={styles.confirmText}>Cancel this request?</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.danger} disabled={busy} onPress={() => void withdraw(r)}><Text style={styles.dangerText}>Cancel request</Text></TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={() => setConfirmCancel(null)}><Text style={styles.ghostText}>Keep</Text></TouchableOpacity>
        </View>
      </View> : <TouchableOpacity onPress={() => setConfirmCancel(r.id)}><Text style={styles.linkDanger}>Cancel request</Text></TouchableOpacity>}
    </View>;
  };

  const renderHome = () => <>
    {upcoming.length > 0 && <Text style={styles.section}>Your sessions</Text>}
    {upcoming.map(a => <View key={a.id} style={styles.card}>
      <View style={styles.row}>
        <MaterialIcons name="event" size={22} color={ZColors.forest} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{fmtSlot(a.startsAt)} – {fmtTime(a.endsAt)}</Text>
          <Text style={styles.meta}>{a.therapistName} · {MODE_LABEL[a.mode]}</Text>
        </View>
      </View>
      <Text style={styles.meta}>Session code <Text style={styles.code}>{a.sessionCode}</Text>. Share it at the counselling cell if asked.</Text>
      {confirmCancel === a.id ? <View style={styles.confirm}>
        <Text style={styles.confirmText}>Cancel this session? The counsellor will see it was cancelled.</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.danger} disabled={busy} onPress={() => void cancelSession(a)}><Text style={styles.dangerText}>Cancel session</Text></TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={() => setConfirmCancel(null)}><Text style={styles.ghostText}>Keep</Text></TouchableOpacity>
        </View>
      </View> : <View style={styles.row}>
        {contactByName(a.therapistName) && <TouchableOpacity onPress={() => void openChat(contactByName(a.therapistName)!.therapistId)}>
          <Text style={styles.link}>Message {a.therapistName}</Text>
        </TouchableOpacity>}
        <TouchableOpacity onPress={() => setConfirmCancel(a.id)}><Text style={styles.linkDanger}>Cancel session</Text></TouchableOpacity>
      </View>}
    </View>)}

    {openRequest && renderRequest(openRequest)}

    {recentClosed && <View style={[styles.card, styles.closedCard]}>
      <Text style={styles.cardTitle}>{recentClosed.status === 'DECLINED' ? `${recentClosed.handledBy ?? 'A counsellor'} couldn’t take your request` : 'Your request expired'}</Text>
      <Text style={styles.meta}>{recentClosed.counsellorNote ?? (recentClosed.status === 'EXPIRED' ? 'None of the times you picked were confirmed in time.' : 'You can send a new request.')}</Text>
    </View>}

    {!openRequest && upcoming.length < 2 && <>
      {upcoming.length === 0 && !recentClosed && <View style={styles.explainer}>
        <MaterialIcons name="support-agent" size={24} color={ZColors.olive} />
        <Text style={styles.explainerTitle}>Talk to a campus counsellor</Text>
        <Text style={styles.explainerText}>Book a one-hour session with the counselling cell, in person or by phone. Pick an open time, or tell them when you’re free.</Text>
      </View>}
      <TouchableOpacity style={styles.primary} onPress={startForm}><Text style={styles.primaryText}>Book or request a session</Text></TouchableOpacity>
    </>}
    {!openRequest && upcoming.length >= 2 && <Text style={styles.meta}>You have two upcoming sessions, the most you can book at once.</Text>}

    {(threads.length > 0 || contacts.length > 0) && <>
      <Text style={styles.section}>Messages</Text>
      {threads.map(t => <TouchableOpacity key={t.id} style={styles.thread} onPress={() => router.push(`/chat/${t.id}` as never)}
        accessibilityLabel={`Chat with ${t.title}${t.unread ? `, ${t.unread} unread` : ''}`}>
        <View style={styles.avatar}><MaterialIcons name="chat-bubble-outline" size={18} color={ZColors.forest} /></View>
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={[styles.cardTitleSm, { flex: 1 }]} numberOfLines={1}>{t.title}</Text>
            {t.lastMessageAt && <Text style={styles.meta}>{fmtMsgTime(t.lastMessageAt)}</Text>}
          </View>
          <View style={styles.row}>
            <Text style={[styles.meta, { flex: 1 }, t.unread > 0 && { color: ZColors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
              {t.lastMessage ? `${t.lastMessage.from === 'STUDENT' ? 'You: ' : ''}${t.lastMessage.body}` : 'No messages yet'}
            </Text>
            {t.unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{t.unread}</Text></View>}
          </View>
        </View>
      </TouchableOpacity>)}
      {contacts.filter(c => !c.threadId).map(c => <TouchableOpacity key={c.therapistId} style={styles.secondary} disabled={busy} onPress={() => void openChat(c.therapistId)}>
        <Text style={styles.secondaryText}>Message {c.name}</Text>
      </TouchableOpacity>)}
      <Text style={styles.meta}>Chat with counsellors you have a request or session with. Replies come during office hours; it isn’t for emergencies.</Text>
    </>}

    {availability && availability.counsellors.length > 0 && <>
      <Text style={styles.section}>Counsellors</Text>
      {availability.counsellors.map(c => {
        const next = availability.openSlots.find(s => s.therapistId === c.id);
        return <View key={c.id} style={styles.counsellor}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{c.name.replace(/^Dr\.?\s*/, '').charAt(0)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitleSm}>{c.name}</Text>
            <Text style={styles.meta}>{[c.bio, c.languages.length ? c.languages.map(l => l.toUpperCase()).join(' · ') : null].filter(Boolean).join(' · ')}</Text>
            <Text style={[styles.meta, next && { color: ZColors.olive, fontWeight: '600' }]}>{next ? `Next open: ${fmtSlot(next.startsAt)}` : 'No open times posted, send a request'}</Text>
          </View>
        </View>;
      })}
    </>}
  </>;

  return <SafeAreaView style={styles.root} edges={['top']}>
    <View style={styles.header}>
      {view !== 'home'
        ? <TouchableOpacity onPress={back} accessibilityLabel="Back"><MaterialIcons name="arrow-back" size={26} color={ZColors.forest} /></TouchableOpacity>
        : <View style={{ width: 26 }} />}
      <Text style={styles.title}>{view === 'home' ? 'Counsellor' : view === 'form' ? 'New session' : 'Other times'}</Text>
      <View style={{ width: 26 }} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={ZColors.olive} />}>
      {!!notice && <View style={styles.notice}><MaterialIcons name="check-circle" size={18} color={ZColors.forest} /><Text style={styles.noticeText}>{notice}</Text></View>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? <ActivityIndicator color={ZColors.olive} style={{ marginTop: 40 }} />
        : view === 'form' ? renderForm() : view === 'retime' ? renderRetime() : renderHome()}
    </ScrollView>
  </SafeAreaView>;
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}>
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ZColors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { color: ZColors.textPrimary, fontSize: 20, fontWeight: '700' },
  content: { padding: 20, paddingTop: 0, gap: 14, paddingBottom: 40 },
  section: { color: ZColors.textSecondary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  explainer: { backgroundColor: ZColors.sageLight, borderRadius: ZRadius.card, padding: 16, gap: 8 },
  explainerTitle: { color: ZColors.forest, fontSize: 17, fontWeight: '700' },
  explainerText: { color: ZColors.forest, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: '#fff', borderRadius: ZRadius.card, padding: 16, gap: 10, ...ZShadow.card },
  closedCard: { backgroundColor: ZColors.creamCard, shadowOpacity: 0, elevation: 0 },
  confirmCard: { backgroundColor: ZColors.sageLight, borderRadius: ZRadius.card, padding: 16, gap: 8 },
  cardTitle: { color: ZColors.textPrimary, fontSize: 17, fontWeight: '700' },
  cardTitleSm: { color: ZColors.textPrimary, fontSize: 15, fontWeight: '700' },
  big: { color: ZColors.forest, fontSize: 22, fontWeight: '800' },
  body: { color: ZColors.textPrimary, fontSize: 15 },
  meta: { color: ZColors.textMuted, fontSize: 13, lineHeight: 19 },
  code: { color: ZColors.forest, fontWeight: '700', fontFamily: 'monospace' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { color: ZColors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 4 },
  input: { backgroundColor: ZColors.cream, borderRadius: ZRadius.small, padding: 12, fontSize: 16, color: ZColors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: ZRadius.pill, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: ZColors.creamCard },
  chipOn: { backgroundColor: ZColors.forest },
  chipText: { color: ZColors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  dayStrip: { gap: 8, paddingVertical: 4 },
  day: { width: 54, paddingVertical: 8, borderRadius: ZRadius.small, backgroundColor: ZColors.cream, alignItems: 'center', gap: 2 },
  dayOn: { backgroundColor: ZColors.forest },
  dayWd: { color: ZColors.textMuted, fontSize: 12, fontWeight: '600' },
  dayNum: { color: ZColors.textPrimary, fontSize: 18, fontWeight: '700' },
  dayTextOn: { color: '#fff' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ZColors.olive },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hour: { width: '48%', flexGrow: 1, borderRadius: ZRadius.small, borderWidth: 1.5, borderColor: ZColors.creamDark, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  hourOpen: { backgroundColor: ZColors.sageLight, borderColor: ZColors.sageMid },
  hourOn: { backgroundColor: ZColors.forest, borderColor: ZColors.forest },
  hourOff: { backgroundColor: ZColors.cream, borderColor: ZColors.cream },
  hourTime: { color: ZColors.textPrimary, fontSize: 15, fontWeight: '700' },
  hourLabel: { color: ZColors.textMuted, fontSize: 12 },
  hourLabelOpen: { color: ZColors.forest, fontWeight: '700' },
  hourTextOn: { color: '#fff' },
  hourTextOff: { color: ZColors.sage },
  pickedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ZColors.sageLight, borderRadius: ZRadius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  pickedText: { color: ZColors.forest, fontSize: 13, fontWeight: '600' },
  timeChip: { backgroundColor: ZColors.cream, borderRadius: ZRadius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  timeChipText: { color: ZColors.textSecondary, fontSize: 13, fontWeight: '600' },
  counsellor: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#fff', borderRadius: ZRadius.card, padding: 14, ...ZShadow.subtle },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: ZColors.sageLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ZColors.forest, fontWeight: '800', fontSize: 17 },
  primary: { backgroundColor: ZColors.olive, borderRadius: ZRadius.pill, paddingVertical: 15, alignItems: 'center', paddingHorizontal: 18 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { borderRadius: ZRadius.pill, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5, borderColor: ZColors.olive },
  secondaryText: { color: ZColors.olive, fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  ghost: { paddingVertical: 10, alignItems: 'center', paddingHorizontal: 10 },
  ghostText: { color: ZColors.textSecondary, fontWeight: '600' },
  linkDanger: { color: ZColors.coralDeep, fontWeight: '700', fontSize: 14 },
  link: { color: ZColors.olive, fontWeight: '700', fontSize: 14 },
  thread: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#fff', borderRadius: ZRadius.card, padding: 14, ...ZShadow.subtle },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: ZColors.coralDeep, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  confirm: { backgroundColor: ZColors.coralLight, borderRadius: ZRadius.small, padding: 12, gap: 8 },
  confirmText: { color: ZColors.textPrimary, fontSize: 14 },
  danger: { backgroundColor: ZColors.coralDeep, borderRadius: ZRadius.pill, paddingHorizontal: 20, paddingVertical: 10 },
  dangerText: { color: '#fff', fontWeight: '700' },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: ZColors.sageLight, borderRadius: ZRadius.small, padding: 12 },
  noticeText: { color: ZColors.forest, fontSize: 14, fontWeight: '600', flex: 1 },
  error: { color: ZColors.coralDeep, fontSize: 14, textAlign: 'center' },
});
