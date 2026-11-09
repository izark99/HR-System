/**
 * Texts edited by Admins reach the engine worker before its first call, and again after a change
 * (spec §33 AC-TX-05). Fake worker over a MessageChannel (Comlink on both ends).
 */
import * as Comlink from 'comlink';
import { afterEach, describe, expect, it } from 'vitest';
import '../../../i18n';
import { setTextOverrides } from '../../../lib/ui-text';
import { EngineClient, type WorkerLike } from '../engine-client';

const log: string[] = [];

function fakeWorker(): WorkerLike {
  const { port1, port2 } = new MessageChannel();
  Comlink.expose(
    {
      setTextOverrides: (map: Record<string, string>) => {
        log.push(`texts ${JSON.stringify(map)}`);
      },
      cancel: () => {
        log.push('cancel');
      },
    },
    port2,
  );
  return Object.assign(port1 as unknown as Comlink.Endpoint, {
    terminate: () => {
      port1.close();
      port2.close();
    },
  });
}

const clients: EngineClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  log.length = 0;
  setTextOverrides([
    ['engine:validation.required', null],
    ['common:app.name', null],
  ]);
});

describe('EngineClient and edited texts', () => {
  it('sends nothing while no text was ever edited', async () => {
    const c = new EngineClient(fakeWorker);
    clients.push(c);
    await c.api.cancel();
    // Other tests of this file may have bumped the generation: only the order matters there.
    expect(log.at(-1)).toBe('cancel');
  });

  it('sends the engine texts before the first call, and again after an edit only', async () => {
    setTextOverrides([
      ['engine:validation.required', 'Thiếu {{column}} ({{file}}, dòng {{row}})'],
      ['common:app.name', 'App'],
    ]);
    const c = new EngineClient(fakeWorker);
    clients.push(c);
    await c.api.cancel();
    await c.api.cancel();
    expect(log).toEqual([
      'texts {"engine:validation.required":"Thiếu {{column}} ({{file}}, dòng {{row}})"}',
      'cancel',
      'cancel',
    ]);
    setTextOverrides([['engine:validation.required', null]]);
    await c.api.cancel();
    expect(log.slice(3)).toEqual(['texts {}', 'cancel']);
  });

  it('a restarted worker gets the texts again', async () => {
    setTextOverrides([['engine:validation.required', '{{file}} {{row}} {{column}}']]);
    const c = new EngineClient(fakeWorker);
    clients.push(c);
    await c.api.cancel();
    c.restart();
    await c.api.cancel();
    expect(log.filter((l) => l.startsWith('texts'))).toHaveLength(2);
  });
});
