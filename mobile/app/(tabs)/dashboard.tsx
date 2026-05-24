import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ZColors, ZRadius, ZShadow } from '@/constants/zindagi-theme';

// ── Static demo data ──────────────────────────────────────────────────────────

const KPI_DATA = [
  {
    id: 'students',
    label: 'Active Students',
    value: '127',
    delta: '+4 today',
    positive: true,
    icon: 'people' as const,
    spark: [112, 118, 122, 119, 124, 121, 127],
    accent: false,
  },
  {
    id: 'mood',
    label: 'Avg Mood Score',
    value: '7.4',
    delta: '+0.3 vs last week',
    positive: true,
    icon: 'mood' as const,
    spark: [71, 73, 72, 75, 74, 76, 74],
    accent: false,
  },
  {
    id: 'alerts',
    label: 'Crisis Alerts',
    value: '3',
    delta: '2 pending review',
    positive: false,
    icon: 'warning' as const,
    spark: [1, 0, 2, 1, 3, 2, 3],
    accent: true,
  },
  {
    id: 'sessions',
    label: 'Sessions Today',
    value: '24',
    delta: '18 completed',
    positive: true,
    icon: 'event-available' as const,
    spark: [18, 22, 20, 25, 21, 26, 24],
    accent: false,
  },
];

// Heatmap: [week][day] — 0 = no data, 1–2 = positive, 3–5 = distress
const HEATMAP: number[][] = [
  [1, 2, 2, 3, 2, 0, 1],
  [2, 2, 3, 2, 2, 1, 0],
  [2, 3, 3, 3, 2, 1, 1],
  [2, 2, 2, 3, 3, 1, 1],
  [3, 4, 4, 5, 3, 2, 1],
  [3, 3, 3, 4, 2, 1, 1],
  [2, 2, 3, 3, 2, 1, 0],
  [1, 2, 2, 2, 2, 1, 0],
  [2, 3, 4, 5, 4, 2, 1],
  [3, 3, 3, 3, 2, 1, 1],
  [2, 2, 2, 2, 1, 1, 0],
  [1, 2, 2, 2, 1, 0, 0],
];

const PROBLEM_DATA = [
  { label: 'Academic', value: 78 },
  { label: 'Anxiety', value: 62 },
  { label: 'Relationships', value: 45 },
  { label: 'Financial', value: 38 },
  { label: 'Family', value: 32 },
];

const YEAR_DATA = [
  { label: '1st', pct: 40, color: ZColors.forest },
  { label: '2nd', pct: 28, color: ZColors.olive },
  { label: '3rd', pct: 20, color: ZColors.sage },
  { label: '4th', pct: 12, color: ZColors.sageLight },
];

const ALERTS = [
  { id: 1, text: 'Student #A047 flagged Unsafe mood 3 times this week', time: '14 min ago', severity: 'high' },
  { id: 2, text: 'Student #B112 missed 4 consecutive check-ins', time: '1 hr ago', severity: 'medium' },
  { id: 3, text: 'Mood score dip detected in Batch 2024-CS cohort', time: '3 hr ago', severity: 'low' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Sub-components ────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <View style={spark.row}>
      {data.map((v, i) => (
        <View
          key={i}
          style={[
            spark.bar,
            {
              height: Math.max(4, (v / max) * 28),
              opacity: 0.3 + (i / data.length) * 0.7,
            },
          ]}
        />
      ))}
    </View>
  );
}

function KPICard({ item, wide }: { item: (typeof KPI_DATA)[0]; wide: boolean }) {
  const bg = item.accent ? ZColors.coralLight : ZColors.creamCard;
  const iconColor = item.accent ? ZColors.coralDeep : ZColors.forest;
  const deltaColor = item.accent
    ? ZColors.coralDeep
    : item.positive
    ? ZColors.olive
    : ZColors.textMuted;

  return (
    <View
      style={[
        kpi.card,
        ZShadow.card,
        { backgroundColor: bg, width: wide ? '48%' : '48%' },
      ]}
    >
      <View style={kpi.header}>
        <MaterialIcons name={item.icon} size={20} color={iconColor} />
        <Text style={[kpi.label, { color: item.accent ? ZColors.coralDeep : ZColors.textSecondary }]}>
          {item.label}
        </Text>
      </View>
      <Text style={[kpi.value, { color: item.accent ? ZColors.coralDeep : ZColors.textPrimary }]}>
        {item.value}
      </Text>
      <Text style={[kpi.delta, { color: deltaColor }]}>{item.delta}</Text>
      {!item.accent && (
        <View style={kpi.sparkWrap}>
          <Sparkline data={item.spark} />
        </View>
      )}
    </View>
  );
}

function Heatmap() {
  return (
    <View>
      {DAY_LABELS.map((day, dayIdx) => (
        <View key={day} style={hm.row}>
          <Text style={hm.dayLabel}>{day}</Text>
          <View style={hm.cells}>
            {HEATMAP.map((week, wk) => (
              <View
                key={wk}
                style={[hm.cell, { backgroundColor: ZColors.heatmap[week[dayIdx]] }]}
              />
            ))}
          </View>
        </View>
      ))}
      {/* Legend */}
      <View style={hm.legend}>
        <Text style={hm.legendLabel}>Positive</Text>
        <View style={hm.legendScale}>
          {ZColors.heatmap.slice(1).map((c, i) => (
            <View key={i} style={[hm.legendCell, { backgroundColor: c }]} />
          ))}
        </View>
        <Text style={hm.legendLabel}>Distress</Text>
      </View>
    </View>
  );
}

function BarChart() {
  const max = Math.max(...PROBLEM_DATA.map(d => d.value));
  const chartH = 110;
  return (
    <View style={bar.container}>
      {PROBLEM_DATA.map((d, i) => {
        const barH = Math.max(8, (d.value / max) * chartH);
        const opacity = 0.55 + (i / PROBLEM_DATA.length) * 0.45;
        return (
          <View key={d.label} style={bar.col}>
            <Text style={bar.pct}>{d.value}%</Text>
            <View style={[bar.fill, { height: barH, opacity }]} />
            <Text style={bar.lbl}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function YearDistribution() {
  return (
    <View style={yd.container}>
      <View style={yd.stackBar}>
        {YEAR_DATA.map(d => (
          <View
            key={d.label}
            style={{ flex: d.pct, backgroundColor: d.color, height: '100%' }}
          />
        ))}
      </View>
      <View style={yd.legend}>
        {YEAR_DATA.map(d => (
          <View key={d.label} style={yd.legendRow}>
            <View style={[yd.dot, { backgroundColor: d.color }]} />
            <Text style={yd.legendText}>
              {d.label} Year — {d.pct}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const isWide = width > 600;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: ZColors.cream }}>
      <StatusBar style="dark" backgroundColor={ZColors.cream} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>Zindagi</Text>
            <Text style={s.subtitle}>Community Well-being Overview</Text>
          </View>
          <View style={s.headerRight}>
            <View style={s.adminBadge}>
              <Text style={s.adminText}>Admin</Text>
            </View>
            <MaterialIcons name="notifications-none" size={22} color={ZColors.forest} />
          </View>
        </View>
        <Text style={s.dateLine}>April 23, 2026 · 127 active students</Text>

        {/* ── KPI Cards ── */}
        <View style={s.kpiRow}>
          {KPI_DATA.map(item => (
            <KPICard key={item.id} item={item} wide={isWide} />
          ))}
        </View>

        {/* ── Heatmap ── */}
        <View style={[s.card, ZShadow.card]}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Student Mood Trends</Text>
            <Text style={s.sectionSub}>Last 12 Weeks</Text>
          </View>
          <Heatmap />
        </View>

        {/* ── Analytics ── */}
        <View style={[s.row, { gap: 12 }]}>
          <View style={[s.card, ZShadow.card, { flex: 1 }]}>
            <Text style={s.sectionTitle}>Problem Frequency</Text>
            <Text style={s.sectionSub}>Top reported concerns</Text>
            <View style={{ height: 12 }} />
            <BarChart />
          </View>
          <View style={[s.card, ZShadow.card, { flex: 1 }]}>
            <Text style={s.sectionTitle}>Year Distribution</Text>
            <Text style={s.sectionSub}>Students by academic year</Text>
            <View style={{ height: 12 }} />
            <YearDistribution />
          </View>
        </View>

        {/* ── Recent Alerts ── */}
        <View style={[s.card, ZShadow.card]}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Recent Alerts</Text>
            <Text style={[s.sectionSub, { color: ZColors.olive }]}>View all</Text>
          </View>
          {ALERTS.map(a => (
            <View key={a.id} style={al.item}>
              <View
                style={[
                  al.dot,
                  {
                    backgroundColor:
                      a.severity === 'high'
                        ? ZColors.coralDeep
                        : a.severity === 'medium'
                        ? ZColors.coral
                        : ZColors.sage,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={al.text}>{a.text}</Text>
                <Text style={al.time}>{a.time}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    color: ZColors.forest,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 13, color: ZColors.textSecondary, marginTop: 1 },
  dateLine: { fontSize: 12, color: ZColors.textMuted, marginBottom: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  adminBadge: {
    backgroundColor: ZColors.sageLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: ZRadius.pill,
  },
  adminText: { fontSize: 11, fontWeight: '700', color: ZColors.forest },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    backgroundColor: ZColors.creamCard,
    borderRadius: ZRadius.card,
    padding: 16,
  },
  row: { flexDirection: 'row' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: ZColors.textPrimary },
  sectionSub: { fontSize: 11, color: ZColors.textMuted },
});

const kpi = StyleSheet.create({
  card: {
    borderRadius: ZRadius.card,
    padding: 14,
    flexGrow: 1,
    minWidth: '47%',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: '600' },
  value: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  delta: { fontSize: 11, marginTop: 2 },
  sparkWrap: { marginTop: 10 },
});

const spark = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30 },
  bar: {
    flex: 1,
    backgroundColor: ZColors.forest,
    borderRadius: 2,
  },
});

const hm = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  dayLabel: {
    width: 28,
    fontSize: 9,
    color: ZColors.textMuted,
    fontWeight: '600',
  },
  cells: { flexDirection: 'row', gap: 3, flex: 1 },
  cell: { flex: 1, height: 18, borderRadius: 3 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    justifyContent: 'flex-end',
  },
  legendScale: { flexDirection: 'row', gap: 3 },
  legendCell: { width: 12, height: 12, borderRadius: 2 },
  legendLabel: { fontSize: 9, color: ZColors.textMuted },
});

const bar = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 140,
  },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  pct: { fontSize: 9, color: ZColors.textMuted, marginBottom: 3, fontWeight: '600' },
  fill: { width: '100%', backgroundColor: ZColors.forest, borderRadius: 4 },
  lbl: {
    fontSize: 8,
    color: ZColors.textMuted,
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '600',
  },
});

const yd = StyleSheet.create({
  container: { gap: 12 },
  stackBar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: ZRadius.pill,
    overflow: 'hidden',
  },
  legend: { gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: ZColors.textSecondary },
});

const al = StyleSheet.create({
  item: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: ZColors.creamDark,
    alignItems: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  text: { fontSize: 12, color: ZColors.textSecondary, lineHeight: 17 },
  time: { fontSize: 10, color: ZColors.textMuted, marginTop: 3 },
});
