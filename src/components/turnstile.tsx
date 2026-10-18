'use client';
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
type TurnstileAPI = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}
export function Turnstile({
  action,
  onToken,
  resetKey = 0,
}: {
  action: string;
  onToken: (token: string) => void;
  resetKey?: number;
}) {
  const container = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  const [loaded, setLoaded] = useState(false);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!sitekey || !loaded || !container.current || !window.turnstile) return;
    callback.current('');
    const id = window.turnstile.render(container.current, {
      sitekey,
      action,
      theme: 'light',
      size: 'flexible',
      callback: (token: string) => callback.current(token),
      'expired-callback': () => callback.current(''),
      'error-callback': () => callback.current(''),
    });
    return () => {
      window.turnstile?.remove(id);
    };
  }, [sitekey, loaded, action, resetKey]);
  if (!sitekey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
      />
      <div className="turnstile-widget" ref={container} />
    </>
  );
}
