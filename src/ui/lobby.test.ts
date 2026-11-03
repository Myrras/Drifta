import { describe, expect, it } from 'vitest';
import {
  errorText,
  initialStep,
  lobbyStep,
  takesInput,
  type LobbyEvent,
  type LobbyMode,
  type LobbyStep,
} from './lobby';

const FAILED = "COULDN'T CONNECT - TRY AGAIN. SOME NETWORKS BLOCK DIRECT CONNECTIONS";

const run = (mode: LobbyMode, ...events: LobbyEvent[]): LobbyStep =>
  events.reduce((s, e) => lobbyStep(mode, s, e), initialStep(mode));

describe('errorText', () => {
  it('maps every reason', () => {
    expect(errorText('version', 'host')).toBe('VERSION MISMATCH - BOTH PLAYERS REFRESH THE PAGE');
    expect(errorText('bad-code', 'join')).toBe("THAT CODE ISN'T VALID - COPY THE WHOLE THING");
    expect(errorText('timeout', 'host')).toBe(FAILED);
    expect(errorText('failed', 'join')).toBe(FAILED);
  });
  it('wrong-kind depends on who is pasting', () => {
    expect(errorText('wrong-kind', 'host')).toBe("THAT'S AN INVITE - PASTE YOUR FRIEND'S REPLY");
    expect(errorText('wrong-kind', 'join')).toBe("THAT'S A REPLY - PASTE THE HOST'S INVITE");
  });
});

describe('host flow', () => {
  it('creating -> invite -> connecting -> open', () => {
    expect(initialStep('host')).toEqual({ k: 'creating' });
    expect(run('host', { t: 'hosted', invite: 'I' })).toEqual({ k: 'invite', invite: 'I' });
    expect(run('host', { t: 'hosted', invite: 'I' }, { t: 'submit' })).toEqual({
      k: 'connecting',
      invite: 'I',
    });
    expect(
      run('host', { t: 'hosted', invite: 'I' }, { t: 'submit' }, { t: 'link', state: 'open' }),
    ).toEqual({ k: 'open' });
  });
  it('accept error returns to the reply input with the invite kept', () => {
    const s = run(
      'host',
      { t: 'hosted', invite: 'I' },
      { t: 'submit' },
      {
        t: 'error',
        reason: 'wrong-kind',
      },
    );
    expect(s).toEqual({ k: 'invite', invite: 'I', error: errorText('wrong-kind', 'host') });
    expect(takesInput(s)).toBe(true);
  });
  it('host() failing goes to failed, retry restarts', () => {
    const s = run('host', { t: 'error', reason: 'timeout' });
    expect(s).toEqual({ k: 'failed', error: FAILED });
    expect(lobbyStep('host', s, { t: 'retry' })).toEqual({ k: 'creating' });
  });
  it('link failure while waiting shows failed', () => {
    expect(run('host', { t: 'hosted', invite: 'I' }, { t: 'link', state: 'failed' })).toEqual({
      k: 'failed',
      error: FAILED,
    });
    expect(
      run('host', { t: 'hosted', invite: 'I' }, { t: 'submit' }, { t: 'link', state: 'closed' }).k,
    ).toBe('failed');
  });
});

describe('join flow', () => {
  it('paste -> joining -> reply -> open', () => {
    expect(initialStep('join')).toEqual({ k: 'paste' });
    expect(run('join', { t: 'submit' })).toEqual({ k: 'joining' });
    expect(run('join', { t: 'submit' }, { t: 'joined', reply: 'R' })).toEqual({
      k: 'reply',
      reply: 'R',
    });
    expect(
      run('join', { t: 'submit' }, { t: 'joined', reply: 'R' }, { t: 'link', state: 'open' }),
    ).toEqual({ k: 'open' });
  });
  it('join error stays on the paste step', () => {
    expect(run('join', { t: 'submit' }, { t: 'error', reason: 'version' })).toEqual({
      k: 'paste',
      error: errorText('version', 'join'),
    });
  });
  it('link failure after reply, then retry back to paste', () => {
    const s = run(
      'join',
      { t: 'submit' },
      { t: 'joined', reply: 'R' },
      {
        t: 'link',
        state: 'failed',
      },
    );
    expect(s.k).toBe('failed');
    expect(lobbyStep('join', s, { t: 'retry' })).toEqual({ k: 'paste' });
  });
});

describe('ignored events', () => {
  it('stale or out-of-order events do not change the step', () => {
    const invite: LobbyStep = { k: 'invite', invite: 'I' };
    expect(lobbyStep('host', invite, { t: 'hosted', invite: 'X' })).toBe(invite);
    expect(lobbyStep('host', invite, { t: 'retry' })).toBe(invite);
    expect(lobbyStep('host', invite, { t: 'link', state: 'connecting' })).toBe(invite);
    const failed = run('host', { t: 'error', reason: 'failed' });
    expect(lobbyStep('host', failed, { t: 'link', state: 'open' })).toBe(failed);
    const open: LobbyStep = { k: 'open' };
    expect(lobbyStep('join', open, { t: 'link', state: 'failed' })).toBe(open);
    expect(lobbyStep('join', { k: 'paste' }, { t: 'joined', reply: 'R' })).toEqual({ k: 'paste' });
    expect(takesInput({ k: 'connecting', invite: 'I' })).toBe(false);
  });
});
