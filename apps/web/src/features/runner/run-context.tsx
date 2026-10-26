import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { FlowSource } from './flow-source';
import type { RunLogger } from './run-log';
import { RunStore, type SessionState } from './run-store';

const RunStoreContext = createContext<RunStore | null>(null);

export function RunStoreProvider({
  source,
  logger = null,
  children,
}: {
  source: FlowSource;
  logger?: RunLogger | null;
  children: ReactNode;
}) {
  const [store] = useState(() => new RunStore(source, { logger }));
  return <RunStoreContext.Provider value={store}>{children}</RunStoreContext.Provider>;
}

export function useRunStore(): RunStore {
  const store = useContext(RunStoreContext);
  if (!store) throw new Error('RunStoreProvider missing');
  return store;
}

export function useRunState(): SessionState {
  const store = useRunStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
