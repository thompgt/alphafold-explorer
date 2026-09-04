import { useEffect, useState } from 'react';
import { api, type HealthResponse } from './api.ts';
import { parseHash, type Route } from './route.ts';
import { Browse } from './views/Browse.tsx';
import { Protein } from './views/Protein.tsx';
import { Ask } from './views/Ask.tsx';

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((cause: unknown) => {
        // /health answers 503 with a body when a dependency is down; that body is
        // more useful than the status code, so show it rather than a generic error.
        const body = (cause as { body?: HealthResponse }).body;
        if (body?.model) setHealth(body);
        else setHealthError(String(cause));
      });
  }, []);

  function navigate(hash: string) {
    window.location.hash = hash;
    setRoute(parseHash(hash));
  }

  return (
    <>
      <header className="app">
        <h1>AlphaFold Explorer</h1>
        <nav>
          <a
            href="#/"
            className={route.name === 'browse' || route.name === 'protein' ? 'active' : ''}
            onClick={(event) => {
              event.preventDefault();
              navigate('#/');
            }}
          >
            Browse
          </a>
          <a
            href="#/ask"
            className={route.name === 'ask' ? 'active' : ''}
            onClick={(event) => {
              event.preventDefault();
              navigate('#/ask');
            }}
          >
            Ask
          </a>
        </nav>
        <div className="spacer" />
        {healthError && <span className="badge bad">API unreachable</span>}
        {health && (
          <>
            <span className={`badge ${health.database.ok ? 'ok' : 'bad'}`} title={health.database.detail}>
              {health.database.detail}
            </span>
            <span className={`badge ${health.model.ok ? 'ok' : 'bad'}`} title={health.model.detail}>
              {health.model.ok ? health.model.chatModel : 'model unavailable'}
            </span>
          </>
        )}
      </header>

      <main>
        {route.name === 'browse' && (
          <Browse onOpen={(accession) => navigate(`#/protein/${accession}`)} />
        )}
        {route.name === 'protein' && (
          <Protein accession={route.accession} onBack={() => navigate('#/')} />
        )}
        {route.name === 'ask' && <Ask onOpen={(accession) => navigate(`#/protein/${accession}`)} />}
      </main>
    </>
  );
}
