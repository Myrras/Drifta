import type { Connector, Link, LinkErrorReason, LinkState } from '../net/protocol';
import { LinkError } from '../net/protocol';
import { THEMES } from './theme';

export type LobbyMode = 'host' | 'join';
export type LobbyResult = { link: Link; role: 'host' | 'guest' } | null;

export type LobbyStep =
  | { k: 'creating' }
  | { k: 'invite'; invite: string; error?: string }
  | { k: 'connecting'; invite: string }
  | { k: 'paste'; error?: string }
  | { k: 'joining'; invite: string }
  | { k: 'reply'; invite: string; reply: string }
  | { k: 'failed'; error: string }
  | { k: 'open' };

export type LobbyEvent =
  | { t: 'hosted'; invite: string }
  | { t: 'joined'; reply: string }
  | { t: 'submit'; code: string }
  | { t: 'error'; reason: LinkErrorReason }
  | { t: 'link'; state: LinkState }
  | { t: 'retry' };

export function errorText(reason: LinkErrorReason, mode: LobbyMode): string {
  switch (reason) {
    case 'version':
      return 'VERSION MISMATCH - BOTH PLAYERS REFRESH THE PAGE';
    case 'bad-code':
      return "THAT CODE ISN'T VALID - COPY THE WHOLE THING";
    case 'wrong-kind':
      return mode === 'host'
        ? "THAT'S AN INVITE - PASTE YOUR FRIEND'S REPLY"
        : "THAT'S A REPLY - PASTE THE HOST'S INVITE";
    case 'timeout':
    case 'failed':
      return "COULDN'T CONNECT - TRY AGAIN. SOME NETWORKS BLOCK DIRECT CONNECTIONS";
  }
}

export const initialStep = (mode: LobbyMode): LobbyStep =>
  mode === 'host' ? { k: 'creating' } : { k: 'paste' };

const FAIL = (mode: LobbyMode): LobbyStep => ({ k: 'failed', error: errorText('failed', mode) });

export function lobbyStep(mode: LobbyMode, s: LobbyStep, e: LobbyEvent): LobbyStep {
  if (s.k === 'open') return s;
  switch (e.t) {
    case 'retry':
      return s.k === 'failed' ? initialStep(mode) : s;
    case 'hosted':
      return s.k === 'creating' ? { k: 'invite', invite: e.invite } : s;
    case 'joined':
      return s.k === 'joining' ? { k: 'reply', invite: s.invite, reply: e.reply } : s;
    case 'submit':
      if (s.k === 'invite') return { k: 'connecting', invite: s.invite };
      if (s.k === 'paste') return { k: 'joining', invite: e.code };
      return s;
    case 'error': {
      const error = errorText(e.reason, mode);
      if (s.k === 'connecting') return { k: 'invite', invite: s.invite, error };
      if (s.k === 'joining') return { k: 'paste', error };
      if (s.k === 'creating') return { k: 'failed', error };
      return s;
    }
    case 'link':
      if (s.k === 'failed') return s;
      if (e.state === 'open') return { k: 'open' };
      if (e.state === 'failed' || e.state === 'closed') return FAIL(mode);
      return s;
  }
}

/** Whether the step has an editable code box whose text is submitted. */
export const takesInput = (s: LobbyStep): boolean => s.k === 'invite' || s.k === 'paste';

// ---------- DOM ----------

const P = 'drifta-lobby';
const th = THEMES.arcade;
const CSS = `
.${P}-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(6,3,20,0.55);font:${th.font(400, 16)};color:${th.text}}
.${P}-panel{width:min(560px,92vw);max-height:92vh;overflow:auto;box-sizing:border-box;padding:24px 28px;background:rgba(16,10,44,0.94);border:2px solid ${th.accent};box-shadow:0 0 24px rgba(255,47,180,0.45),inset 0 0 18px rgba(46,242,255,0.12);text-transform:uppercase;letter-spacing:.06em}
.${P}-title{margin:0 0 16px;font:${th.font(700, 26, true)};color:${th.accent2};text-shadow:0 0 10px ${th.accent2}}
.${P}-label{margin:14px 0 6px;font:${th.font(600, 14)};color:${th.dim}}
.${P}-code{display:block;width:100%;box-sizing:border-box;height:72px;resize:none;padding:8px;background:rgba(4,3,16,0.8);color:${th.text};border:1px solid ${th.dim};font:12px/1.35 Consolas,"Lucida Console",monospace;word-break:break-all;text-transform:none;letter-spacing:0}
.${P}-code:focus{outline:none;border-color:${th.accent2}}
.${P}-code.${P}-dim{opacity:.55;color:${th.dim}}
.${P}-code.${P}-hot,.${P}-code.${P}-hot:focus{border:2px solid ${th.accent};box-shadow:0 0 10px ${th.accent}}
.${P}-row,.${P}-foot{display:flex;gap:10px;justify-content:flex-end;margin-top:8px}
.${P}-foot{margin-top:20px}
.${P}-btn{font:${th.font(700, 15)};text-transform:uppercase;letter-spacing:.08em;padding:8px 16px;cursor:pointer;background:transparent;color:${th.text};border:1px solid ${th.dim}}
.${P}-btn:hover,.${P}-btn:focus-visible{outline:none;border-color:${th.accent2};color:${th.accent2}}
.${P}-main{background:${th.panelSel};border-color:${th.accent}}
.${P}-main:hover,.${P}-main:focus-visible{color:${th.text};border-color:${th.accent};box-shadow:0 0 12px ${th.accent}}
.${P}-status{margin:18px 0 6px;font:${th.font(700, 18)};color:${th.accent2}}
.${P}-hint{min-height:1em;margin-top:6px;font:${th.font(400, 13)};color:${th.dim}}
.${P}-error{margin-top:12px;font:${th.font(700, 14)};color:${th.accent}}
`;

const reasonOf = (err: unknown): LinkErrorReason =>
  err instanceof LinkError ? err.reason : 'failed';

export function openLobby(
  mode: LobbyMode,
  connector: Connector,
  done: (r: LobbyResult) => void,
  doc: Document = document,
): { close(): void } {
  const win = doc.defaultView ?? window;
  let s = initialStep(mode);
  let gen = 0;
  let link: Link | null = null;
  let accept: ((reply: string) => Promise<void>) | null = null;
  let input = '';
  let finished = false;
  const timers = new Set<number>();
  const downIn = new Set<string>();

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (cls) e.className = `${P}-${cls}`;
    if (text) e.textContent = text;
    return e;
  };
  const btn = (text: string, onClick: () => void, main = false) => {
    const b = el('button', main ? 'btn ' + `${P}-main` : 'btn', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  const style = el('style');
  style.textContent = CSS;
  const root = el('div', 'root');
  const panel = el('div', 'panel');
  root.append(panel);
  doc.head.append(style);
  doc.body.append(root);

  const inPanel = (t: EventTarget | null) => t instanceof win.Node && panel.contains(t);
  const onWinKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    } else if (inPanel(e.target)) downIn.add(e.code);
    else e.stopPropagation();
  };
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => {
    if (downIn.delete(e.code)) e.stopPropagation();
  });
  win.addEventListener('keydown', onWinKey, true);

  function finish(r: LobbyResult): void {
    if (finished) return;
    finished = true;
    gen++;
    win.removeEventListener('keydown', onWinKey, true);
    for (const t of timers) win.clearTimeout(t);
    root.remove();
    style.remove();
    if (!r) link?.close();
    done(r);
  }

  function dispatch(e: LobbyEvent): void {
    if (finished) return;
    s = lobbyStep(mode, s, e);
    if (s.k === 'open' && link) finish({ link, role: mode === 'host' ? 'host' : 'guest' });
    else render();
  }

  function watch(l: Link, g: number): void {
    link = l;
    l.onState((state) => g === gen && dispatch({ t: 'link', state }));
    if (l.state !== 'connecting') dispatch({ t: 'link', state: l.state });
  }

  function start(): void {
    const g = ++gen;
    link?.close();
    link = accept = null;
    input = '';
    s = initialStep(mode);
    render();
    if (mode !== 'host') return;
    Promise.resolve()
      .then(() => connector.host())
      .then(
        (h) => {
          if (g !== gen) return h.link.close();
          accept = h.accept;
          dispatch({ t: 'hosted', invite: h.invite });
          watch(h.link, g);
        },
        (err) => g === gen && dispatch({ t: 'error', reason: reasonOf(err) }),
      );
  }

  function submit(box: HTMLTextAreaElement): void {
    const code = input.trim();
    if (!takesInput(s) || !code) return box.focus();
    const g = gen;
    dispatch({ t: 'submit', code });
    Promise.resolve()
      .then(() =>
        mode === 'host'
          ? accept!(code)
          : connector.join(code).then((h) => {
              if (g !== gen) return h.link.close();
              dispatch({ t: 'joined', reply: h.reply });
              watch(h.link, g);
            }),
      )
      .catch((err) => g === gen && dispatch({ t: 'error', reason: reasonOf(err) }));
  }

  function copy(ta: HTMLTextAreaElement, b: HTMLButtonElement): void {
    const ok = () => {
      b.textContent = 'COPIED';
      const t = win.setTimeout(() => {
        timers.delete(t);
        b.textContent = 'COPY';
      }, 1500);
      timers.add(t);
    };
    const fallback = () => {
      ta.focus();
      ta.select();
      try {
        if (doc.execCommand('copy')) ok();
      } catch {
        // nothing left to try; the text stays selected for ctrl+c
      }
    };
    const cb = win.navigator.clipboard;
    if (cb?.writeText) cb.writeText(ta.value).then(ok, fallback);
    else fallback();
  }

  function paste(ta: HTMLTextAreaElement, hint: HTMLElement): void {
    const denied = () => {
      hint.textContent = 'PRESS CTRL+V';
      ta.focus();
    };
    const cb = win.navigator.clipboard;
    if (!cb?.readText) return denied();
    cb.readText().then((t) => {
      if (!ta.isConnected) return;
      ta.value = input = t.trim();
      hint.textContent = '';
      ta.focus();
    }, denied);
  }

  function render(): void {
    panel.replaceChildren(el('h2', 'title', mode === 'host' ? 'HOST A GAME' : 'JOIN A GAME'));
    let focus: HTMLElement | null = null;
    const label = (text: string) => panel.append(el('div', 'label', text));
    const status = (text: string) => panel.append(el('div', 'status', text));
    const codeOut = (code: string, hot = false) => {
      const ta = el('textarea', hot ? 'code ' + `${P}-hot` : 'code');
      ta.readOnly = true;
      ta.value = code;
      ta.addEventListener('focus', () => ta.select());
      const b = btn('COPY', () => copy(ta, b), true);
      const row = el('div', 'row');
      row.append(b);
      panel.append(ta, row);
      focus ??= b;
    };
    const codeShown = (code: string) => {
      const ta = el('textarea', 'code ' + `${P}-dim`);
      ta.readOnly = true;
      ta.tabIndex = -1;
      ta.value = code;
      panel.append(ta);
    };
    const codeIn = (placeholder: string, action: string) => {
      const ta = el('textarea', 'code');
      ta.spellcheck = false;
      ta.placeholder = placeholder;
      ta.value = input;
      ta.addEventListener('input', () => (input = ta.value));
      ta.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        submit(ta);
      });
      const hint = el('div', 'hint');
      const row = el('div', 'row');
      row.append(
        btn('PASTE', () => paste(ta, hint)),
        btn(action, () => submit(ta), true),
      );
      panel.append(ta, hint, row);
      if (!focus || input) focus = ta;
    };

    switch (s.k) {
      case 'creating':
        status('CREATING INVITE...');
        break;
      case 'invite':
        label('1. SEND THIS TO YOUR FRIEND');
        codeOut(s.invite);
        label("2. PASTE YOUR FRIEND'S REPLY");
        codeIn('REPLY CODE', 'CONNECT');
        break;
      case 'paste':
        label("1. PASTE THE HOST'S INVITE");
        codeIn('INVITE CODE', 'JOIN');
        break;
      case 'connecting':
        status('CONNECTING...');
        break;
      case 'joining':
        label("1. PASTE THE HOST'S INVITE");
        codeShown(s.invite);
        status('CREATING REPLY...');
        break;
      case 'reply':
        label("1. PASTE THE HOST'S INVITE");
        codeShown(s.invite);
        label('2. SEND THIS REPLY BACK TO THE HOST');
        codeOut(s.reply, true);
        status('WAITING FOR THE HOST TO PASTE YOUR REPLY...');
        break;
      case 'failed':
      case 'open':
        break;
    }
    if ((s.k === 'invite' || s.k === 'paste' || s.k === 'failed') && s.error)
      panel.append(el('div', 'error', s.error));
    const foot = el('div', 'foot');
    if (s.k === 'failed') {
      const retry = btn('RETRY', start, true);
      foot.append(retry);
      focus ??= retry;
    }
    const cancel = btn('CANCEL', () => finish(null));
    foot.append(cancel);
    panel.append(foot);
    (focus ?? cancel).focus();
  }

  start();
  return { close: () => finish(null) };
}
