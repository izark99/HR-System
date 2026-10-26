import { RouterProvider } from '@tanstack/react-router';
import { localFlowSource } from '../features/runner/local-flow-source';
import { RunStoreProvider } from '../features/runner/run-context';
import { router } from './router';

export function App() {
  return (
    <RunStoreProvider source={localFlowSource}>
      <RouterProvider router={router} />
    </RunStoreProvider>
  );
}
