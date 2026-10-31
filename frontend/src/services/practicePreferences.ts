import { useSyncExternalStore } from "react";
export interface PracticePreferences {
  avatarVisible: boolean;
  voiceReplies: boolean;
  reduceMotion: boolean;
}
const defaults: PracticePreferences = {
  avatarVisible: true,
  voiceReplies: false,
  reduceMotion: false,
};
let value = { ...defaults };
const listeners = new Set<() => void>();
/** Browser-session preferences only. Hosted persistence belongs to the signed-in account adapter. */
export const practicePreferences = {
  getSnapshot: () => value,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  set: (patch: Partial<PracticePreferences>) => {
    value = { ...value, ...patch };
    listeners.forEach((fn) => fn());
  },
  reset: () => {
    value = { ...defaults };
    listeners.forEach((fn) => fn());
  },
};
export const usePracticePreferences = () =>
  useSyncExternalStore(
    practicePreferences.subscribe,
    practicePreferences.getSnapshot,
    practicePreferences.getSnapshot,
  );
