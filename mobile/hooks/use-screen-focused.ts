import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/** True while this screen is focused. Used to pause Moss's animation clock on hidden tabs. */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
}
