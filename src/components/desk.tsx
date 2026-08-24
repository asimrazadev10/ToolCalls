'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentUIMessage } from '@/lib/ai/types';
import { SEED_QUESTIONS } from '@/lib/ui/constants';
import { Barograph } from './barograph';
import { ToolCall } from './results';

/** Within this many pixels of the bottom still counts as "reading the end". */
const FOLLOW_THRESHOLD_PX = 120;

/**
 * The old copy blamed the API key for every failure. The route now answers
 * refusals as JSON, so surface what it actually said and keep the key hint for
 * the case where nothing came back at all.
 */
function errorNote(error: Error) {
  try {
    const reason: unknown = JSON.parse(error.message)?.error;
    if (typeof reason === 'string' && reason) return reason;
  } catch {
    // Not a JSON body — fall through to the generic note.
  }
  return 'The desk could not reach the model. Check the API key and try again.';
}

export function Desk() {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLElement>(null);

  // Following the stream is only helpful while the reader is already at the
  // bottom. Scroll up to re-read an earlier card and the desk should stay put.
  const following = useRef(true);

  const { messages, sendMessage, setMessages, status, stop, error, clearError } =
    useChat<AgentUIMessage>({
      transport: new DefaultChatTransport({ api: '/api/chat' }),
    });

  // A run that ends without an answer — stopped, or failed upstream — leaves the
  // question sitting in the history with nothing under it. That is not just ugly:
  // the next send hands the model every unanswered turn at once, so it tries to
  // satisfy all of them and the tool calls compound with each failure. Take the
  // question back out of the history and return it to the composer.
  const [interrupted, setInterrupted] = useState(false);
  const rescueWanted = useRef(false);

  const busy = status === 'submitted' || status === 'streaming';
  const empty = messages.length === 0;

  // The transcript scrolls, not the window, so the listener belongs on it.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      following.current = scrollHeight - (scrollTop + clientHeight) < FOLLOW_THRESHOLD_PX;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!following.current) return;
    const gentle = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: gentle ? 'smooth' : 'auto', block: 'end' });
  }, [messages, status]);

  const textOf = (message: AgentUIMessage) =>
    message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

  const rescue = useCallback(() => {
    const kept = [...messages];

    // An assistant turn with tool calls but no prose is not an answer.
    while (
      kept.length &&
      kept.at(-1)!.role === 'assistant' &&
      !textOf(kept.at(-1)!)
    ) {
      kept.pop();
    }

    const orphan = kept.at(-1);
    if (orphan?.role !== 'user') return;

    kept.pop();
    setMessages(kept);
    setInput(textOf(orphan));
    setInterrupted(true);
  }, [messages, setMessages]);

  // Only ever runs after a deliberate stop or a real error, never on the brief
  // window between sendMessage and the request starting — which would delete
  // the question the user just asked.
  useEffect(() => {
    if (error) rescueWanted.current = true;
  }, [error]);

  useEffect(() => {
    if (busy || !rescueWanted.current) return;
    rescueWanted.current = false;
    rescue();
  }, [busy, rescue]);

  function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    // Asking re-arms the follow: you want to see the answer you just requested.
    following.current = true;
    rescueWanted.current = false;
    setInterrupted(false);
    clearError();
    sendMessage({ text: q });
    setInput('');
  }

  let exchange = 0;

  return (
    <div className="shell">
      <header className="rail">
        <div className="rail__id">
          <span className="rail__mark">ISOBAR</span>
          <span className="rail__tag">briefing desk</span>
        </div>
        <div className="rail__instrument" data-active={busy}>
          <Barograph active={busy} />
          <span className="rail__now">now</span>
        </div>
      </header>

      {/* Announce state changes only. The transcript itself must not be a live
          region: every streamed token mutates it, so a screen reader would
          re-read the whole growing briefing on each chunk. */}
      <p className="u-sr" role="status" aria-live="polite">
        {busy ? 'Building the briefing.' : error ? 'The briefing failed.' : ''}
      </p>

      <main ref={transcriptRef} className={`transcript${empty ? ' transcript--open' : ''}`}>
        {empty && (
          <section className="open">
            <span className="u-label">the desk is open</span>
            <h1 className="open__head">Ask about the weather anywhere.</h1>
            <p className="open__sub">
              Isobar reads live station data — conditions, seven-day forecast and air
              quality — then tells you what it means.
            </p>
            <div className="open__list">
              {SEED_QUESTIONS.map((seed, i) => (
                <button
                  key={seed}
                  type="button"
                  className="seed"
                  style={{ animationDelay: `${180 + i * 70}ms` }}
                  onClick={() => ask(seed)}
                >
                  <span className="seed__idx">{String(i + 1).padStart(2, '0')}</span>
                  <span>{seed}</span>
                  <span className="seed__go">ask →</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {messages.map((message) => {
          if (message.role === 'user') exchange += 1;

          return (
            <article className="turn" key={message.id}>
              <div className="turn__meta">
                <span className="u-label">
                  {String(exchange).padStart(2, '0')} ·{' '}
                  {message.role === 'user' ? 'you' : 'isobar'}
                </span>
              </div>

              {message.parts.map((part, i) => {
                // Matches every tool in the registry, so adding one needs no
                // change here — only a card in ToolOutput.
                if (isToolUIPart(part)) {
                  return <ToolCall key={part.toolCallId} part={part} />;
                }

                if (part.type !== 'text') return null;

                return message.role === 'user' ? (
                  <h2 className="ask" key={i}>
                    {part.text}
                  </h2>
                ) : (
                  <div className="brief" key={i}>
                    {part.text.split(/\n{2,}/).map((para, p) => (
                      <p key={p}>{para}</p>
                    ))}
                  </div>
                );
              })}
            </article>
          );
        })}

        <div ref={endRef} />
      </main>

      <form
        className="desk"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <div className="desk__inner">
          <div className="field">
            <label className="u-label" htmlFor="ask">
              your question
            </label>
            <input
              id="ask"
              className="field__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about the weather anywhere"
              autoComplete="off"
              // `readOnly`, not `disabled`: disabling a focused input throws
              // focus back to <body> mid-turn and blocks typing ahead.
              readOnly={busy}
            />
            <span className="field__rule" aria-hidden="true" />
          </div>

          {busy ? (
            <button
              type="button"
              className="btn btn--stop"
              onClick={() => {
                rescueWanted.current = true;
                stop();
              }}
            >
              Stop
            </button>
          ) : (
            <button type="submit" className="btn" disabled={!input.trim()}>
              Get briefing
            </button>
          )}

          <p className="desk__note" data-error={Boolean(error) || interrupted}>
            {error
              ? `${errorNote(error)} Your question is back in the field.`
              : interrupted
                ? 'Briefing stopped. Your question is back in the field.'
                : 'Live readings from Open-Meteo. Press Enter to send.'}
          </p>
        </div>
      </form>
    </div>
  );
}
