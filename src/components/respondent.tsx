'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Send,
  ShieldCheck,
  Eye,
  ListChecks,
} from 'lucide-react';
import { api, ApiError, formatDate } from '@/lib/client';
import { validateValues, type PublicForm, type Values } from '@/lib/domain';
import { Brand, Spinner } from './ui';
import { PdfPage } from './pdf-page';
import { Turnstile } from './turnstile';

type Receipt = { id: string; receipt: string; submittedAt: string };
export function Respondent({ token, preview = false }: { token: string; preview?: boolean }) {
  const [form, setForm] = useState<PublicForm | null>(null),
    [loadError, setLoadError] = useState('');
  const [values, setValues] = useState<Values>({}),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false),
    [saved, setSaved] = useState(false),
    [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [captcha, setCaptcha] = useState(''),
    [captchaReset, setCaptchaReset] = useState(0);
  const [page, setPage] = useState(0),
    [mobileView, setMobileView] = useState<'fields' | 'pdf'>('fields');
  const key = useRef(''),
    idempotency = useRef('');
  useEffect(() => {
    api<PublicForm>(preview ? `/api/forms/${token}/preview` : `/api/public/${token}`)
      .then((data) => {
        setForm(data);
        key.current = `forme-draft:${preview ? 'preview:' : ''}${token}:v${data.version}`;
        idempotency.current = crypto.randomUUID();
        try {
          const stored = localStorage.getItem(key.current);
          if (stored) {
            const draft = JSON.parse(stored);
            if (draft.values && typeof draft.values === 'object') setValues(draft.values);
            if (typeof draft.idempotencyKey === 'string')
              idempotency.current = draft.idempotencyKey;
          }
          const existingReceipt = !preview && localStorage.getItem(`${key.current}:receipt`);
          if (existingReceipt) setReceipt(JSON.parse(existingReceipt));
        } catch {
          setStorageError(true);
        }
        setReady(true);
      })
      .catch((e) => setLoadError(e.message));
  }, [token, preview]);
  useEffect(() => {
    if (!ready || receipt) return;
    setSaved(false);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          key.current,
          JSON.stringify({ values, idempotencyKey: idempotency.current }),
        );
        setSaved(true);
      } catch {
        setStorageError(true);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [values, ready, receipt]);

  function change(id: string, value: string | boolean) {
    setValues((v) => ({ ...v, [id]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[id];
      delete next._form;
      return next;
    });
  }
  function focus(id: string) {
    setMobileView('fields');
    setTimeout(() => document.getElementById(`answer-${id}`)?.focus(), 0);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || busyRef.current) return;
    const checked = validateValues(form.definition, values);
    if (Object.keys(checked.errors).length) {
      setErrors(checked.errors);
      focus(Object.keys(checked.errors)[0]);
      return;
    }
    setBusy(true);
    busyRef.current = true;
    setErrors({});
    try {
      if (preview) {
        const response = await fetch(`/api/forms/${token}/preview-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: checked.values }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new ApiError(error.error, response.status, error.details);
        }
        const { url } = await response.json();
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.title}_プレビュー.pdf`;
        a.click();
      } else {
        const result = await api<Receipt>(`/api/public/${token}/submit`, {
          method: 'POST',
          body: JSON.stringify({
            version: form.version,
            values: checked.values,
            idempotencyKey: idempotency.current,
            turnstileToken: captcha || undefined,
          }),
        });
        setReceipt(result);
        try {
          localStorage.setItem(`${key.current}:receipt`, JSON.stringify(result));
          localStorage.removeItem(key.current);
        } catch {
          /* Receipt remains available in memory. */
        }
      }
    } catch (e) {
      const error = e as ApiError;
      setErrors({ ...(error.details || {}), _form: error.message });
      if (error.details) focus(Object.keys(error.details)[0]);
    } finally {
      setBusy(false);
      busyRef.current = false;
      setCaptchaReset((n) => n + 1);
    }
  }
  if (loadError)
    return (
      <div className="public-error">
        <Brand linked={preview} />
        <span className="public-error-icon">
          <FileText size={32} />
        </span>
        <h1>フォームを開けませんでした</h1>
        <p>{loadError}</p>
        <p className="muted">リンクをご確認いただくか、フォームの作成者にお問い合わせください。</p>
        {preview && (
          <Link className="button subtle" href={`/forms/${token}`}>
            編集画面へ戻る
          </Link>
        )}
      </div>
    );
  if (!form) return <Spinner label="フォームを読み込んでいます…" />;
  if (receipt)
    return (
      <div className="public-success-page">
        <header>
          <Brand linked={false} />
          <span>PDFから、伝わるフォームへ。</span>
        </header>
        <main className="success-card">
          <span className="success-check">
            <Check size={35} />
          </span>
          <div className="eyebrow">THANK YOU</div>
          <h1>回答を受け付けました。</h1>
          <p>
            「{form.title}」へのご回答、
            <br />
            ありがとうございました。
          </p>
          <div className="receipt-info">
            <span>
              送信日時<strong>{formatDate(receipt.submittedAt)}</strong>
            </span>
            <span>
              受付番号<strong>{receipt.id.slice(0, 8).toUpperCase()}</strong>
            </span>
          </div>
          <a className="button primary full" href={`/api/receipts/${receipt.receipt}/pdf`}>
            <ArrowDownToLine size={17} />
            記入済みPDFをダウンロード
          </a>
          <p className="receipt-note">
            <ShieldCheck size={14} />
            控えとしてお手元に保存できます。
          </p>
        </main>
        <footer>
          Made with <Brand small linked={false} />
        </footer>
      </div>
    );
  const required = form.definition.fields.filter((f) => f.required),
    done = required.filter((f) =>
      f.type === 'checkbox'
        ? values[f.id] === true
        : typeof values[f.id] === 'string' && String(values[f.id]).trim(),
    ).length;
  return (
    <div className={`respondent-shell ${preview ? 'preview-mode' : ''}`}>
      {preview && (
        <div className="preview-banner">
          <div className="preview-message">
            <Eye size={20} />
            <span>
              <strong>回答画面のプレビュー</strong>
              <small>入力してPDFを試せます。回答は送信されません。</small>
            </span>
          </div>
          <Link className="button subtle preview-return" href={`/forms/${token}`}>
            <ArrowLeft size={18} />
            編集に戻る
          </Link>
        </div>
      )}
      <header className="respondent-header">
        <Brand linked={preview} />
        <span>
          <LockKeyhole size={13} />
          フォームへの回答
        </span>
      </header>
      <main className="respondent-main">
        <div className="respondent-heading">
          <span className="document-tag">
            <FileText size={12} />
            APPLICATION FORM
          </span>
          <h1>{form.title}</h1>
          {form.description && <p>{form.description}</p>}
        </div>
        <div className="mobile-view-toggle">
          <button
            className={mobileView === 'fields' ? 'active' : ''}
            onClick={() => setMobileView('fields')}
          >
            <ListChecks size={16} />
            入力フォーム
          </button>
          <button
            className={mobileView === 'pdf' ? 'active' : ''}
            onClick={() => setMobileView('pdf')}
          >
            <FileText size={16} />
            PDFを確認
          </button>
        </div>
        <div className="respondent-grid">
          <section
            className={`respondent-document ${mobileView === 'pdf' ? 'mobile-visible' : ''}`}
            aria-label="PDFプレビュー"
          >
            <div className="respondent-doc-toolbar">
              <span>
                <FileText size={14} />
                書類プレビュー
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="前のページ"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                {page + 1} / {form.pages.length}
                <button
                  className="icon-button"
                  aria-label="次のページ"
                  disabled={page + 1 >= form.pages.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            <div className="respondent-pdf-wrap">
              <PdfPage
                url={preview ? `/api/forms/${token}/pdf` : `/api/public/${token}/pdf`}
                page={page}
                size={form.pages[page]}
              >
                {form.definition.fields
                  .filter((f) => f.page === page)
                  .map((f) => {
                    const value = values[f.id];
                    const answered =
                      f.type === 'checkbox'
                        ? value === true
                        : typeof value === 'string' && value.trim().length > 0;
                    const style = {
                      left: `${f.x * 100}%`,
                      top: `${f.y * 100}%`,
                      width: `${f.width * 100}%`,
                      height: `${f.height * 100}%`,
                    };
                    if (answered)
                      return (
                        <span
                          key={f.id}
                          className={`pdf-answer-text ${f.type === 'textarea' ? 'multiline' : ''} ${f.type === 'checkbox' ? 'checkmark' : ''}`}
                          style={style}
                        >
                          {f.type === 'checkbox' ? <Check aria-label={f.label} /> : String(value)}
                        </span>
                      );
                    return (
                      <button
                        key={f.id}
                        className={`answer-overlay ${errors[f.id] ? 'invalid' : ''}`}
                        title={`${f.label}を入力`}
                        onClick={() => focus(f.id)}
                        style={style}
                      >
                        {f.type === 'checkbox' ? (
                          <span className="overlay-checkbox" />
                        ) : (
                          <span className="overlay-placeholder">{f.label}</span>
                        )}
                      </button>
                    );
                  })}
              </PdfPage>
            </div>
            <div className="doc-preview-note">入力内容は書類プレビューにも反映されます。</div>
          </section>
          <section
            className={`respondent-input ${mobileView === 'fields' ? 'mobile-visible' : ''}`}
          >
            <div className="answer-card-heading">
              <h2>必要事項をご記入ください</h2>
              <p>
                <span className="required-text">*</span> は必須項目です
              </p>
            </div>
            <div className="answer-progress">
              <span>
                必須項目の入力状況
                <strong>
                  {done}
                  <small> / {required.length}</small>
                </strong>
              </span>
              <div>
                <i
                  style={{ width: `${required.length ? (done / required.length) * 100 : 100}%` }}
                />
              </div>
            </div>
            <form onSubmit={submit} noValidate>
              <div className="answer-fields">
                {form.definition.fields.map((f, index) => (
                  <div key={f.id} className={`answer-field ${errors[f.id] ? 'has-error' : ''}`}>
                    {f.type === 'checkbox' ? (
                      <label className="answer-checkbox">
                        <input
                          id={`answer-${f.id}`}
                          type="checkbox"
                          checked={values[f.id] === true}
                          required={f.required}
                          aria-invalid={!!errors[f.id]}
                          aria-describedby={errors[f.id] ? `error-${f.id}` : undefined}
                          onChange={(e) => change(f.id, e.target.checked)}
                        />
                        <span>
                          {f.label}
                          {f.required && <em>*</em>}
                        </span>
                      </label>
                    ) : (
                      <>
                        <label htmlFor={`answer-${f.id}`}>
                          <span className="answer-number">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {f.label}
                          {f.required && <em>*</em>}
                        </label>
                        {f.type === 'textarea' ? (
                          <textarea
                            id={`answer-${f.id}`}
                            value={String(values[f.id] || '')}
                            placeholder={f.placeholder || 'こちらに入力してください'}
                            rows={4}
                            maxLength={1000}
                            required={f.required}
                            aria-invalid={!!errors[f.id]}
                            aria-describedby={errors[f.id] ? `error-${f.id}` : undefined}
                            onChange={(e) => change(f.id, e.target.value)}
                            onFocus={() => setPage(f.page)}
                          />
                        ) : (
                          <input
                            id={`answer-${f.id}`}
                            type={
                              f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'
                            }
                            value={String(values[f.id] || '')}
                            placeholder={f.placeholder || 'こちらに入力してください'}
                            maxLength={160}
                            required={f.required}
                            aria-invalid={!!errors[f.id]}
                            aria-describedby={errors[f.id] ? `error-${f.id}` : undefined}
                            autoComplete={
                              f.type === 'email'
                                ? 'email'
                                : /名前|氏名/.test(f.label)
                                  ? 'name'
                                  : 'off'
                            }
                            onChange={(e) => change(f.id, e.target.value)}
                            onFocus={() => setPage(f.page)}
                          />
                        )}
                      </>
                    )}
                    {errors[f.id] && (
                      <p className="field-error" id={`error-${f.id}`} role="alert">
                        {errors[f.id]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {errors._form && (
                <div className="form-error" role="alert">
                  {errors._form}
                </div>
              )}
              <div className="answer-submit-area">
                <div className="draft-indicator">
                  {storageError ? (
                    'このブラウザでは下書きを保存できません'
                  ) : saved ? (
                    <>
                      <Check size={13} />
                      下書きをこのブラウザに保存しました
                    </>
                  ) : (
                    '下書きを保存しています…'
                  )}
                </div>
                {!preview && (
                  <Turnstile action="submit-form" onToken={setCaptcha} resetKey={captchaReset} />
                )}
                <button
                  className="button primary full"
                  type="submit"
                  disabled={
                    busy ||
                    !form.definition.fields.length ||
                    (!preview && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captcha)
                  }
                >
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : preview ? (
                    <ArrowDownToLine size={17} />
                  ) : (
                    <Send size={17} />
                  )}
                  {busy
                    ? '処理しています…'
                    : preview
                      ? '記入済みPDFをダウンロード'
                      : '回答を送信する'}
                  {!busy && <ArrowRight size={16} />}
                </button>
                <p>
                  {preview
                    ? '入力内容を使ったPDFを保存します。回答は送信されません。'
                    : '送信前に、入力内容をご確認ください。'}
                </p>
              </div>
            </form>
          </section>
        </div>
        <footer className="respondent-footer">
          <span>Made with</span>
          <Brand small linked={preview} />
          <span>PDFから、伝わるフォームへ。</span>
        </footer>
      </main>
    </div>
  );
}
