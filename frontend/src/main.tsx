import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { keys } from './api/hooks';
import { App } from './App';
import './styles.css';

// Any 401 (expired or cleared session) re-checks "me", which shows the login form.
// The "me" query itself is excluded: its 401 is the expected "logged out" answer,
// and re-checking it on its own error would loop forever.
function onApiError(err: unknown, queryKey?: readonly unknown[]) {
  if (err instanceof ApiError && err.status === 401 && queryKey?.[0] !== keys.me[0]) {
    void queryClient.invalidateQueries({ queryKey: keys.me });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err, query) => onApiError(err, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (err) => onApiError(err) }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Retrying a 401 only delays the switch to the login form.
      retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 3,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
