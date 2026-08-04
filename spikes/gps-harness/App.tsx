// Throwaway harness for spike #4 — Expo background GPS field test.
// Not production code: no i18n, no theme, hardcoded everything.
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Battery from 'expo-battery';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import * as TaskManager from 'expo-task-manager';

const TASK_NAME = 'gps-spike-task';
const FILE_URI = `${FileSystem.documentDirectory}fixes.jsonl`;

type Fix = {
  ts: number; // fix timestamp (ms epoch, from the GPS fix itself)
  recvTs: number; // when the JS task received it (batching delay = recvTs - ts)
  lat: number;
  lng: number;
  acc: number | null;
  speed: number | null;
  battery: number; // 0..1, -1 if unavailable
};

// Module-level so the background task (which runs headless, no React) can append.
let fixes: Fix[] = [];
let listeners: Array<() => void> = [];

async function appendFixes(newFixes: Fix[]) {
  fixes = [...fixes, ...newFixes];
  listeners.forEach((fn) => fn());
  const lines = newFixes.map((f) => JSON.stringify(f)).join('\n') + '\n';
  const info = await FileSystem.getInfoAsync(FILE_URI);
  const existing = info.exists
    ? await FileSystem.readAsStringAsync(FILE_URI)
    : '';
  await FileSystem.writeAsStringAsync(FILE_URI, existing + lines);
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  TASK_NAME,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const battery = await Battery.getBatteryLevelAsync().catch(() => -1);
    const recvTs = Date.now();
    await appendFixes(
      data.locations.map((l) => ({
        ts: l.timestamp,
        recvTs,
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        acc: l.coords.accuracy,
        speed: l.coords.speed,
        battery,
      })),
    );
  },
);

async function goOnline(): Promise<string | null> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'Foreground location permission denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted')
    return 'Background permission denied — pick "Allow all the time" / "Always"';

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 4000, // Android fix floor
    distanceInterval: 10, // or every 10 m, whichever first
    deferredUpdatesInterval: 0, // deliver immediately, don't batch
    deferredUpdatesDistance: 0,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'GPS spike: online',
      notificationBody: 'Recording fixes for the field test.',
      killServiceOnDestroy: false,
    },
  });
  return null;
}

export default function App() {
  const [online, setOnline] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const rerender = () => setTick((t) => t + 1);
    listeners.push(rerender);
    // Reload fixes persisted by earlier runs (or while backgrounded pre-kill).
    FileSystem.getInfoAsync(FILE_URI).then(async (info) => {
      if (!info.exists) return;
      const text = await FileSystem.readAsStringAsync(FILE_URI);
      fixes = text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Fix);
      rerender();
    });
    Location.hasStartedLocationUpdatesAsync(TASK_NAME).then(setOnline);
    return () => {
      listeners = listeners.filter((fn) => fn !== rerender);
    };
  }, []);

  const toggle = async () => {
    if (online) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
      setOnline(false);
    } else {
      const err = await goOnline();
      if (err) Alert.alert('Cannot go online', err);
      else setOnline(true);
    }
  };

  const exportFile = async () => {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (!info.exists) return Alert.alert('Nothing to export yet');
    await Sharing.shareAsync(FILE_URI, { mimeType: 'application/json' });
  };

  const clear = async () => {
    await FileSystem.deleteAsync(FILE_URI, { idempotent: true });
    fixes = [];
    setTick((t) => t + 1);
  };

  const recent = [...fixes].slice(-100).reverse();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.title}>GPS spike harness</Text>
      <Text style={styles.count}>
        {fixes.length} fixes
        {fixes.length > 0 &&
          ` · battery ${Math.round(fixes[fixes.length - 1].battery * 100)}%`}
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={toggle}
          style={[styles.btn, online ? styles.btnStop : styles.btnGo]}
        >
          <Text style={styles.btnText}>{online ? 'Go offline' : 'Go online'}</Text>
        </Pressable>
        <Pressable onPress={exportFile} style={[styles.btn, styles.btnAux]}>
          <Text style={styles.btnText}>Export</Text>
        </Pressable>
        <Pressable onPress={clear} style={[styles.btn, styles.btnAux]}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>
      <FlatList
        data={recent}
        keyExtractor={(f) => String(f.recvTs) + String(f.ts)}
        renderItem={({ item, index }) => {
          const prev = recent[index + 1];
          const gapS = prev ? (item.ts - prev.ts) / 1000 : 0;
          return (
            <Text style={[styles.fix, gapS > 15 && styles.fixGap]}>
              {new Date(item.ts).toLocaleTimeString()} ·{' '}
              {item.lat.toFixed(5)},{item.lng.toFixed(5)} · ±
              {item.acc?.toFixed(0) ?? '?'}m
              {prev ? ` · gap ${gapS.toFixed(1)}s` : ''}
            </Text>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111', paddingHorizontal: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 8 },
  count: { color: '#9a9', fontSize: 14, marginVertical: 4 },
  row: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
  },
  btnGo: { backgroundColor: '#2a7' },
  btnStop: { backgroundColor: '#c33' },
  btnAux: { backgroundColor: '#345' },
  btnText: { color: '#fff', fontWeight: '600' },
  fix: { color: '#ccc', fontFamily: 'monospace', fontSize: 12, paddingVertical: 1 },
  fixGap: { color: '#f66' },
});
