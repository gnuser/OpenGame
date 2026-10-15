'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Gamepad2, LogOut, ArrowRight } from 'lucide-react';

interface Session {
  mode: 'local' | 'invite';
  user: { id: string; label: string } | null;
}
const SessionContext = createContext<Session>({ mode: 'local', user: null });
export const useSession = () => useContext(SessionContext);

export function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session>();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('暂时无法连接工作台，请稍后重试。');
      setSession(await response.json());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const check = () => {
      void refresh();
    };
    window.addEventListener('focus', check);
    window.addEventListener('opengame-session-expired', check);
    const timer = setInterval(check, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('opengame-session-expired', check);
    };
  }, []);
  if (pathname === '/marketplace') return <>{children}</>;
  if (session && (session.mode === 'local' || session.user))
    return <SessionContext value={session}>{children}</SessionContext>;
  return (
    <main className="invite-page">
      <section className="invite-card">
        <div className="brand">
          <span className="brandmark">
            <Gamepad2 size={24} />
          </span>
          OpenGame
        </div>
        <Link href="/marketplace">浏览作品广场 →</Link>
        <span className="eyebrow">受邀内测 · 从一个想法开始</span>
        <h1>
          让你的想法，
          <br />
          成为可玩的游戏。
        </h1>
        <p>
          描述玩法，在线试玩，在对话中不断打磨。
          <br />
          使用邀请人发给你的专属访问码进入工作台。
        </p>
        {session ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const response = await fetch('/api/session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '登录未完成');
                setCode('');
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="invite-code">内测访问码</label>
            <input
              id="invite-code"
              type="password"
              autoComplete="current-password"
              value={code}
              maxLength={200}
              onChange={(e) => setCode(e.target.value)}
              placeholder="粘贴你的专属访问码"
              required
            />
            <button className="button primary" disabled={busy || !code.trim()}>
              {busy ? '正在进入…' : '进入创作工作台'}
              <ArrowRight size={17} />
            </button>
          </form>
        ) : (
          <p>正在连接工作台…</p>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {!session && error && (
          <button className="button" onClick={() => void refresh()}>
            重新连接
          </button>
        )}
        <small>每人一个访问码，请妥善保管。作品介绍公开可见，试玩与创作需受邀登录。</small>
      </section>
    </main>
  );
}
export function AccountMenu() {
  const { mode, user } = useSession();
  const [error, setError] = useState('');
  if (mode === 'local')
    return (
      <>
        <span className="local-badge">本地工作台</span>
        <span className="avatar">你</span>
      </>
    );
  return (
    <div className="account-menu">
      <span className="local-badge">受邀内测</span>
      <span>{user?.label}</span>
      <button
        className="icon-button"
        aria-label="退出登录"
        title={error || '退出登录'}
        onClick={async () => {
          try {
            const r = await fetch('/api/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            if (!r.ok && r.status !== 401)
              throw new Error('退出未完成，请重试');
            for (const key of Object.keys(localStorage))
              if (
                key.startsWith(`opengame-draft-${user?.id}-`) ||
                key.startsWith(`opengame-canvas-${user?.id}-`)
              )
                localStorage.removeItem(key);
            window.location.assign('/');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <LogOut size={16} />
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
