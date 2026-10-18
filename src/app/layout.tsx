import type { Metadata } from 'next';
import { Providers } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Forme — PDFから、伝わるフォームへ。', template: '%s | Forme' },
  description:
    'いつものPDFを、回答できるフォームに。入力欄の配置から共有、回答の回収、記入済みPDFの出力まで。',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
