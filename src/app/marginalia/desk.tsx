'use client';

import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './marginalia.module.css';

interface StoredDocument {
  id: string;
  title: string;
  status: string;
  page_count: number | null;
}

interface Citation {
  chunkId: string;
  documentTitle: string;
  headingPath: string[];
  pageFrom: number | null;
  excerpt: string;
}

interface Exchange {
  id: string;
  question: string;
  answered: boolean;
  answer: string;
  confidence: 'high' | 'low';
  citations: Citation[];
}

export function Desk(props: { supabaseUrl: string; supabasePublishableKey: string }) {
  const supabase = useMemo(
    () =>
      createClient(props.supabaseUrl, props.supabasePublishableKey, {
        db: { schema: 'rag' },
      }),
    [props.supabaseUrl, props.supabasePublishableKey],
  );

  const [session, setSession] = useState<{ token: string; email: string } | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'asking' | 'uploading' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Closes over the client rather than taking it as a parameter: SupabaseClient
  // defaults its schema generic to "public", so annotating a rag-scoped client
  // as one reports a mismatch.
  const loadDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, status, page_count')
      .order('created_at', { ascending: false });

    // Surfaced rather than discarded. `data ?? []` renders a failed query as
    // "you have no documents", which is a different and much worse thing to
    // tell someone than "the list could not be loaded".
    if (error) {
      setProblem(`Your documents could not be listed: ${error.message}`);
      return;
    }

    setDocuments(data ?? []);
  }, [supabase]);

  // Driven by auth state rather than by the sign-in handler. Loading documents
  // straight after signInWithPassword resolves races the client attaching the
  // session, and the list came back empty — indistinguishable from having no
  // documents. Subscribing means the list loads whenever a session exists, by
  // whichever route it arrived: fresh sign-in, restored tab, refreshed token.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, current) => {
      if (!current) {
        setSession(null);
        setDocuments([]);
        return;
      }
      setSession({ token: current.access_token, email: current.user.email ?? '' });
      void loadDocuments();
    });

    void supabase.auth.getSession();

    return () => subscription.subscription.unsubscribe();
  }, [supabase, loadDocuments]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    const form = new FormData(event.currentTarget);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });

    if (error || !data.session) {
      setProblem(error?.message ?? 'That email and password did not match.');
    }
    // The auth subscription above picks the session up and loads the documents.
  }

  async function signOut() {
    await supabase.auth.signOut();
    setExchanges([]);
    // Session and documents are cleared by the auth subscription.
  }

  async function addDocument(file: File) {
    if (!session) return;
    setBusy('uploading');
    setProblem(null);

    try {
      const response = await fetch('/api/rag/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'x-filename': file.name },
        body: file,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'That document could not be read.');
      await loadDocuments();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'That document could not be read.');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked || !session) return;

    setBusy('asking');
    setProblem(null);
    setQuestion('');

    try {
      const response = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: asked }),
      });
      const body = (await response.json()) as Exchange & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'That question could not be answered.');

      setExchanges((previous) => [
        { ...body, id: crypto.randomUUID(), question: asked },
        ...previous,
      ]);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'That question could not be answered.');
      setQuestion(asked);
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return (
      <main className={styles.gate}>
        <div className={styles.gateInner}>
          <h1 className={styles.wordmark}>Marginalia</h1>
          <p className={styles.gateLede}>
            Ask questions of your own documents. Every answer points at the page it came from,
            or says plainly that your documents do not cover it.
          </p>
          <form className={styles.gateForm} onSubmit={signIn}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email</span>
              <input name="email" type="email" required autoComplete="username" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Password</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className={styles.button}>
              Sign in
            </button>
          </form>
          {problem && <p className={styles.problem}>{problem}</p>}
        </div>
      </main>
    );
  }

  return (
    <div className={styles.shelf}>
      <header className={styles.shelfHead}>
        <h1 className={`${styles.wordmark} ${styles.wordmarkSmall}`}>Marginalia</h1>
        <div className={styles.shelfAccount}>
          <span className={styles.accountEmail}>{session.email}</span>
          <button type="button" className={`${styles.button} ${styles.buttonQuiet}`} onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.tabs} aria-label="Your documents">
        {documents.map((document) => (
          <span className={styles.tab} key={document.id}>
            <span className={styles.tabTitle}>{document.title}</span>
            <span className={styles.tabMeta}>
              {document.status !== 'ready'
                ? document.status
                : document.page_count
                  ? `${document.page_count} ${document.page_count === 1 ? 'page' : 'pages'}`
                  : 'ready'}
            </span>
          </span>
        ))}

        <label className={`${styles.tab} ${styles.tabAdd}`}>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,text/plain,text/markdown"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addDocument(file);
            }}
          />
          {busy === 'uploading' ? 'Reading…' : 'Add a document'}
        </label>
      </section>

      <form className={styles.ask} onSubmit={ask}>
        <input
          id="marginalia-question"
          name="question"
          className={styles.askField}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={
            documents.length === 0
              ? 'Add a document first, then ask about it'
              : 'What do your documents say?'
          }
          readOnly={busy === 'asking'}
          aria-label="Your question"
        />
        <button type="submit" className={styles.button} disabled={!question.trim() || busy !== null}>
          {busy === 'asking' ? 'Reading…' : 'Ask'}
        </button>
      </form>

      {problem && <p className={`${styles.problem} ${styles.problemInline}`}>{problem}</p>}

      <main className={styles.sheet}>
        {exchanges.length === 0 && documents.length > 0 && (
          <p className={styles.sheetEmpty}>
            Answers appear here, with their sources noted in the margin.
          </p>
        )}

        {exchanges.map((exchange) => (
          <article className={styles.entry} key={exchange.id}>
            <aside className={styles.entryMargin}>
              {exchange.citations.map((citation, index) => (
                <figure className={styles.note} key={citation.chunkId}>
                  <figcaption className={styles.noteHead}>
                    <span className={styles.noteIndex}>{index + 1}</span>
                    <span className={styles.noteWhere}>
                      {citation.headingPath.at(-1) ?? citation.documentTitle}
                      {citation.pageFrom !== null && (
                        <span className={styles.notePage}>p.{citation.pageFrom}</span>
                      )}
                    </span>
                  </figcaption>
                  <blockquote className={styles.noteExcerpt}>{citation.excerpt}</blockquote>
                </figure>
              ))}
              {!exchange.answered && <p className={`${styles.note} ${styles.noteSilent}`}>Not in your documents.</p>}
            </aside>

            <div className={styles.entryBody}>
              <h2 className={styles.entryQuestion}>{exchange.question}</h2>
              <p
                className={`${styles.entryAnswer}${exchange.answered ? '' : ` ${styles.entryAnswerSilent}`}`}
              >
                {exchange.answer}
              </p>
              {exchange.answered && exchange.confidence === 'low' && (
                <p className={styles.entryCaveat}>
                  The closest passages matched only loosely. Check the source before relying on
                  this.
                </p>
              )}
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
