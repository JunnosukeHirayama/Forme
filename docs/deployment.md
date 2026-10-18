# 本番接続とデプロイ

構成は **Vercel（Next.js）＋ Supabase（Auth / PostgreSQL / Storage）＋ Cloudflare（DNS / Turnstile）** です。
アカウントを作成し、本番用の設定値を登録する作業が残ります。接続情報はGitへコミットしません。

## 1. Supabaseプロジェクト

1. 本番用プロジェクトを作成。アプリに近いリージョンを選びます。Vercelの初期設定は東京 `hnd1` です。
2. プロジェクトURL、Publishable key、サーバー専用Secret keyを取得します。Secret keyはブラウザや `NEXT_PUBLIC_*` に渡しません。旧Service role keyもサーバー用として利用できます。
3. CLIで認証し、プロジェクトを確認してから移行を適用します。

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

実行先が本番であることを確認してください。既存の別アプリがあるプロジェクトを使い回さず、この作品専用のプロジェクトを作ります。

移行SQLはテーブル・RLS・サービス専用RPC・非公開Storageバケット `forme-private` を作成します。匿名ユーザーや認証済みブラウザにStorageの直接閲覧・書き込みポリシーを追加しないでください。

## 2. メール認証

Supabase Authで以下を設定します。

- Email providerを有効化し、メールアドレスの確認を有効にする。
- Anonymous sign-insは無効。
- 運用者だけが使う場合は一般の新規登録を無効化し、必要なアカウントを作成／招待する。アプリの `NEXT_PUBLIC_ALLOW_SIGNUP` も `false` にする。
- 一般登録を許可する場合は、Supabase側の新規登録とアプリ側のフラグを両方有効にする。アプリのフラグだけでは認証基盤の登録を制限できない点に注意する。
- Site URLを本番の正確なオリジンにする（例 `https://forms.example.com`）。
- Magic LinkとConfirm Signupのメールテンプレートに **`{{ .Token }}`** を表示する。リポジトリの `supabase/templates/otp.html` を使える。ログイン画面は6〜8桁に対応し、初期推奨設定は6桁・10分。
- 外部利用者へコードを届けるためCustom SMTPを設定し、送信元ドメインの認証を完了する。

Supabaseの既定メール送信は一般利用者向けの本番配信には使えません。プロジェクトチーム外への送信にはCustom SMTPが必要です。[公式SMTPガイド](https://supabase.com/docs/guides/auth/auth-smtp)

このアプリはパスワードを保存しません。同じメールの確認コードで別の端末からログインでき、Cookieを失った場合も再ログインできます。

## 3. Cloudflare TurnstileとDNS

1. Turnstileのウィジェットを作成し、本番のホスト名を登録。Site keyをアプリ公開設定へ、Secret keyをサーバー設定へ入れる。
2. Supabase AuthのBot / CAPTCHA protectionでもTurnstileを選び、対応するSecret keyを登録する。アプリはログイン要求時に `captchaToken` を渡す。
3. 回答送信ではアプリサーバーがSiteverifyを呼び、`success`・`hostname`・`action=submit-form` を検証する。ブラウザの結果だけでは受け付けない。
4. VercelでCustom Domainを追加し、そこで表示されたDNSレコードをCloudflareへ登録する。値はプロジェクトごとに確認し、固定値を推測しない。
5. CloudflareのProxyは **DNS only（灰色の雲）** にする。CloudflareはDNSとTurnstileを担当し、配信・WAFはVercel側を使う。

Vercelは前段へのリバースプロキシ追加を推奨していません。二重CDNによるセッションのキャッシュやクライアントIPの問題を避けるため、この構成ではCloudflare Proxyを使いません。[Vercel公式](https://vercel.com/kb/guide/cloudflare-with-vercel)

本番ではTurnstile未設定・検証失敗時に新しい回答を受け付けません。ローカルの開発サーバーだけは未設定で試せます。[サーバー検証の仕様](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 4. Vercel

GitHubリポジトリをImportし、FrameworkをNext.js、Node.jsを24にします。Install / Buildは `npm ci` / `npm run build` です。

| 環境変数                               | 内容                             | 公開範囲     |
| -------------------------------------- | -------------------------------- | ------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | 本番SupabaseのURL                | ブラウザ可   |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key                  | ブラウザ可   |
| `SUPABASE_SECRET_KEY`                  | Secret / service role key        | サーバー専用 |
| `SITE_URL`                             | 本番オリジン、末尾スラッシュなし | サーバー専用 |
| `NEXT_PUBLIC_ALLOW_SIGNUP`             | 招待のみは `false`               | ブラウザ可   |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`       | 本番ホスト用Site key             | ブラウザ可   |
| `TURNSTILE_SECRET_KEY`                 | Turnstile Secret                 | サーバー専用 |
| `CRON_SECRET`                          | 32文字以上のランダムな秘密値     | サーバー専用 |

`CRON_SECRET` は `openssl rand -hex 32` などで生成します。値をログやIssueに貼らないでください。

環境変数を設定して再デプロイします。`NEXT_PUBLIC_*` はビルド時に組み込まれるため、設定変更後の再デプロイが必要です。

PreviewはProductionと別のSupabaseを使い、Preview自身の正確な `SITE_URL` とTurnstileホストを設定します。本番DBをPreviewへ接続しません。

Vercel Functionsには入出力のサイズ上限があるため、原本のアップロードとPDFの取得はStorageへ直接接続します。APIには小さなJSONとリダイレクトだけを通します。[公式制限](https://vercel.com/docs/functions/limitations)

## 5. 公開後の確認

- 別ブラウザでメールの確認コードを受け取り、ログイン・ログアウト・再ログインができる。
- 他アカウントのフォームIDを指定しても、フォーム・原本・回答を取得できない。
- 4.5MBを超えるPDFを選択してアップロードし、プレビュー・公開・回答・控えの取得ができる。
- 公開後の下書き変更が回答画面を変えない。公開更新後に古い版で送ると409になる。
- 回答の同時再送は一件になる。受付停止後の新規回答は拒否する。
- Turnstileの期限切れ・不正なホスト・不正なactionは拒否する。
- 認証と回答を返すレスポンスが `private, no-store` で、他ユーザーへキャッシュ配信されない。
- Vercel Cronが認証付きで成功し、一時ファイルと削除対象が整理される。
- DBとPDFを別々にバックアップし、別環境で復元してPDFを開ける。

この確認を終えてから、実際の利用者に公開URLを渡します。ローカルの `test:cloud` 成功は、実ドメイン・SMTP・本番Turnstileの確認を代替しません。

## 旧SQLiteからの移行

元の `.data/` を保管します。WAL利用中はSQLiteのバックアップ機能を使うか、旧サーバーを停止してからDB・WALをまとめて保管してください。

```bash
# 元データを読むだけの確認
npm run legacy:import -- --workspace SOURCE_WORKSPACE_UUID --owner DESTINATION_USER_UUID
# 接続先ホスト名を明示してコピー
npm run legacy:import -- --workspace SOURCE_WORKSPACE_UUID --owner DESTINATION_USER_UUID --target YOUR_REF.supabase.co --apply
```

実行時の `.env.local` は移行先の接続情報です。移行先アカウントはメール確認済みである必要があります。移行先の既存内容と衝突した場合は上書きせず停止します。失敗後は作成済みデータを確認してから再試行してください。

元データは読み取り専用で、フォームID・版・公開トークン・回答・控えをコピーします。ホスト名が変わる場合、共有URLのドメイン部分は変わります。サーバー用の旧Cookieは移さず、新しいアカウントに所有権を紐づけます。

`npm run legacy:export -- --workspace SOURCE_WORKSPACE_UUID` で、クラウドへ接続せず原本とJSONを書き出すこともできます。書き出しには回答と共有トークンを含むため、Gitに追加しません。
