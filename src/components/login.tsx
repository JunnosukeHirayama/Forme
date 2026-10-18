'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, ArrowRight, LoaderCircle } from 'lucide-react';
import { Brand } from './ui';
import { Turnstile } from './turnstile';
import { browserSupabase } from '@/lib/supabase/browser';
export function Login({ configured, allowSignup }: { configured: boolean; allowSignup: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [captcha, setCaptcha] = useState(''),
    [reset, setReset] = useState(0);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const client = browserSupabase();
      if (!sent) {
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: allowSignup, captchaToken: captcha || undefined },
        });
        if (error)
          throw new Error(
            '確認コードを送信できませんでした。メールアドレスと確認チェックをご確認のうえ、少し待って再試行してください。',
          );
        setSent(true);
      } else {
        const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw new Error('確認コードが正しくないか、有効期限が切れています。');
        router.replace('/');
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setReset((n) => n + 1);
    }
  }
  return (
    <main className="auth-page">
      <Brand linked={false} />
      <section className="auth-card">
        <span className="auth-icon">
          <Mail size={24} />
        </span>
        <h1>{configured ? 'ワークスペースにログイン' : 'この環境は準備中です'}</h1>
        {!configured ? (
          <p>管理者がクラウド接続の設定を完了すると、ログインして利用できます。</p>
        ) : (
          <>
            <p>
              {sent
                ? `${email} に送信した確認コードを入力してください。`
                : allowSignup
                  ? 'メールの確認コードでログイン・新規登録できます。'
                  : '登録済みのメールアドレスに確認コードを送信します。'}
            </p>
            <form onSubmit={submit}>
              {!sent ? (
                <label>
                  メールアドレス
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    maxLength={254}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
              ) : (
                <label>
                  確認コード
                  <input
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,8}"
                    minLength={6}
                    maxLength={8}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="メールに届いた数字"
                  />
                </label>
              )}
              {!sent && <Turnstile action="login" onToken={setCaptcha} resetKey={reset} />}
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
              <button
                className="button primary full"
                disabled={
                  busy || (!sent && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captcha)
                }
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{' '}
                {sent ? 'ログインする' : '確認コードを送信'}
              </button>
              {sent && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setSent(false);
                    setCode('');
                    setError('');
                  }}
                >
                  メールアドレスを変更・コードを再送
                </button>
              )}
            </form>
            <p className="auth-note">回答者はログインせずに共有URLから回答できます。</p>
          </>
        )}
      </section>
    </main>
  );
}
