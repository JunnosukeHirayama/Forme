'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  FileText,
  FolderOpen,
  Inbox,
  LayoutGrid,
  List,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Upload,
  X,
  Link2,
  MousePointer2,
  Send,
  Clock3,
} from 'lucide-react';
import type { FormRecord, SubmissionRecord, SubmissionPage } from '@/lib/domain';
import { api, formatDate } from '@/lib/client';
import { Brand, Empty, Modal, Spinner, useToast, Pagination } from './ui';
import { PdfPage } from './pdf-page';
import { browserSupabase } from '@/lib/supabase/browser';
import { MAX_PDF_BYTES, STORAGE_BUCKET } from '@/lib/config';

export function Dashboard({ email }: { email: string }) {
  const router = useRouter(),
    toast = useToast();
  const [forms, setForms] = useState<FormRecord[] | null>(null),
    [error, setError] = useState('');
  const [responsePage, setResponsePage] = useState(0),
    [responseTotal, setResponseTotal] = useState(0);
  const [section, setSection] = useState<'forms' | 'responses'>('forms');
  const [responses, setResponses] = useState<SubmissionRecord[] | null>(null);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [view, setView] = useState<'grid' | 'list'>('list');
  const [modal, setModal] = useState<'new' | 'help' | 'workspace' | null>(null),
    [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false);
  const [remove, setRemove] = useState<FormRecord | null>(null),
    [menu, setMenu] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      await api('/api/workspace', { method: 'POST' });
      setForms(await api<FormRecord[]>('/api/forms'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (section === 'responses')
      api<SubmissionPage>(`/api/submissions?page=${responsePage}`)
        .then((result) => {
          setResponses(result.items);
          setResponseTotal(result.total);
        })
        .catch((e) => toast(e.message, true));
  }, [section, toast, responsePage]);
  // Dismiss contextual menus on outside interaction.
  useEffect(() => {
    if (!menu) return;
    const listener = () => setMenu(null);
    document.addEventListener('click', listener);
    return () => document.removeEventListener('click', listener);
  }, [menu]);
  async function create(file?: File) {
    setBusy(true);
    try {
      let form: FormRecord;
      if (file) {
        if (!/\.pdf$/i.test(file.name) || !file.size || file.size > MAX_PDF_BYTES)
          throw new Error('PDFは0〜12MBの範囲で選択してください');
        const upload = await api<{ id: string; path: string; token: string }>('/api/uploads', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, size: file.size }),
        });
        const { error } = await browserSupabase()
          .storage.from(STORAGE_BUCKET)
          .uploadToSignedUrl(upload.path, upload.token, file, { contentType: 'application/pdf' });
        if (error)
          throw new Error('アップロードできませんでした。接続を確認して再試行してください');
        form = await api<FormRecord>(`/api/uploads/${upload.id}/complete`, { method: 'POST' });
      } else form = await api<FormRecord>('/api/forms', { method: 'POST', body: '{}' });
      router.push(`/forms/${form.id}`);
    } catch (e) {
      toast((e as Error).message, true);
      setBusy(false);
    }
  }
  async function copyLink(form: FormRecord) {
    if (!form.token) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/f/${form.token}`);
      toast('回答用URLをコピーしました');
    } catch {
      toast('URLをコピーできませんでした', true);
    }
  }
  const shown =
    forms?.filter(
      (form) =>
        (filter === 'all' || form.status === filter) &&
        form.title.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const responseCount = forms?.reduce((sum, f) => sum + f.responseCount, 0) || 0;
  return (
    <div className="app-shell management-shell">
      <aside className="sidebar">
        <Brand />
        <button
          aria-label="マイワークスペース"
          className="workspace-switch"
          onClick={() => setModal('workspace')}
        >
          <span className="workspace-avatar">M</span>
          <span>
            マイワークスペース<small>Supabase account</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">ワークスペース</div>
        <nav aria-label="メインメニュー">
          <button
            className={section === 'forms' ? 'nav-item active' : 'nav-item'}
            onClick={() => setSection('forms')}
          >
            <FolderOpen size={18} />
            フォーム<span className="nav-count">{forms?.length || 0}</span>
          </button>
          <button
            className={section === 'responses' ? 'nav-item active' : 'nav-item'}
            onClick={() => setSection('responses')}
          >
            <Inbox size={18} />
            すべての回答{responseCount > 0 && <span className="nav-count">{responseCount}</span>}
          </button>
        </nav>
        <div className="sidebar-divider" />
        <button className="nav-item" onClick={() => setModal('help')}>
          <CircleHelp size={18} />
          使い方ガイド
          <ArrowUpRight size={14} className="nav-end" />
        </button>
        <div className="sidebar-bottom">
          <button
            aria-label="ワークスペース設定"
            className="account"
            onClick={() => setModal('workspace')}
          >
            <span className="account-avatar">M</span>
            <span>
              マイワークスペース<small>クラウドワークスペース</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-topbar">
          <div className="breadcrumb">
            <span>ワークスペース</span>
            <span>/</span>
            <strong>{section === 'forms' ? 'フォーム' : 'すべての回答'}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button"
              aria-label="使い方ガイド"
              onClick={() => setModal('help')}
            >
              <CircleHelp size={19} />
            </button>
            <span className="account-avatar small">M</span>
          </div>
        </header>
        <main className="dashboard-main">
          <div className="page-heading">
            <div>
              <h1>
                {section === 'forms' ? 'フォーム' : 'すべての回答'}
                <span className="management-total">
                  {section === 'forms' ? (forms?.length ?? '—') : responseCount}件
                </span>
              </h1>
            </div>
            <button className="button primary" onClick={() => setModal('new')}>
              <Plus size={17} />
              新しいフォーム
            </button>
          </div>
          {section === 'forms' && (
            <>
              <section className="forms-section">
                <div className="management-toolbar">
                  <div className="filter-tabs">
                    {[
                      ['all', 'すべて'],
                      ['published', '公開中'],
                      ['draft', '下書き'],
                      ['closed', '受付終了'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={filter === value ? 'active' : ''}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                        <span>
                          {value === 'all'
                            ? forms?.length || 0
                            : forms?.filter((form) => form.status === value).length || 0}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="section-tools">
                    <div className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="フォームを検索"
                        placeholder="フォームを検索"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button aria-label="検索をクリア" onClick={() => setSearch('')}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div className="view-toggle">
                      <button
                        className={view === 'grid' ? 'selected' : ''}
                        aria-label="カード表示"
                        aria-pressed={view === 'grid'}
                        onClick={() => setView('grid')}
                      >
                        <LayoutGrid size={16} />
                      </button>
                      <button
                        className={view === 'list' ? 'selected' : ''}
                        aria-label="リスト表示"
                        aria-pressed={view === 'list'}
                        onClick={() => setView('list')}
                      >
                        <List size={17} />
                      </button>
                    </div>
                  </div>
                </div>
                {error ? (
                  <Empty title="読み込めませんでした" description={error}>
                    <button className="button primary" onClick={refresh}>
                      再読み込み
                    </button>
                  </Empty>
                ) : !forms ? (
                  <Spinner />
                ) : !shown.length ? (
                  <Empty
                    title={
                      search || filter !== 'all'
                        ? 'フォームが見つかりません'
                        : 'フォームはまだありません'
                    }
                    description={
                      search || filter !== 'all'
                        ? '検索条件やフィルターを変更してください。'
                        : 'PDFをアップロードして、最初のフォームを作成してください。'
                    }
                  >
                    {!search && filter === 'all' && (
                      <button className="button primary" onClick={() => setModal('new')}>
                        <Plus size={16} />
                        フォームを作成
                      </button>
                    )}
                  </Empty>
                ) : view === 'list' ? (
                  <div className="form-table-wrap">
                    <table className="form-table" aria-label="フォーム一覧">
                      <thead>
                        <tr>
                          <th>フォーム名</th>
                          <th>公開状態</th>
                          <th>回答</th>
                          <th>最終更新</th>
                          <th className="form-actions-heading">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((form) => (
                          <tr key={form.id}>
                            <td className="form-name-cell">
                              <Link href={`/forms/${form.id}`} className="form-name-link">
                                <span className="form-file-icon">
                                  <FileText size={20} strokeWidth={1.6} />
                                </span>
                                <span>
                                  <strong>{form.title}</strong>
                                  <small>
                                    {form.pages.length}ページ · {form.draft.fields.length}項目
                                  </small>
                                </span>
                              </Link>
                            </td>
                            <td className="form-status-cell">
                              <span className={`status-badge ${form.status}`}>
                                {statusLabel(form.status)}
                              </span>
                            </td>
                            <td className="form-answers-cell">
                              <Link
                                className="form-answer-count"
                                href={`/forms/${form.id}/responses`}
                                aria-label={`${form.title}の回答 ${form.responseCount}件`}
                              >
                                <Inbox size={14} />
                                <strong>{form.responseCount}</strong>
                                <span>件</span>
                              </Link>
                            </td>
                            <td className="form-updated-cell">
                              <span className="mobile-cell-label">更新 </span>
                              {formatDate(form.updatedAt)}
                            </td>
                            <td className="form-actions-cell">
                              <div className="form-row-actions">
                                <Link
                                  className="button subtle small"
                                  href={`/forms/${form.id}`}
                                  aria-label={`${form.title}を編集`}
                                >
                                  編集
                                </Link>
                                <button
                                  className="button subtle small"
                                  aria-label={`${form.title}の回答用URLをコピー`}
                                  title={
                                    form.token ? '回答用URLをコピー' : '公開すると共有できます'
                                  }
                                  disabled={!form.token}
                                  onClick={() => copyLink(form)}
                                >
                                  <Link2 size={14} />
                                  <span>共有</span>
                                </button>
                                <FormMenu
                                  form={form}
                                  open={menu === form.id}
                                  onToggle={() => setMenu(menu === form.id ? null : form.id)}
                                  onRemove={() => setRemove(form)}
                                  onCopy={() => copyLink(form)}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="form-collection grid">
                    {shown.map((form) => (
                      <article className="form-card" key={form.id}>
                        <Link
                          className="card-preview"
                          href={`/forms/${form.id}`}
                          tabIndex={-1}
                          aria-hidden="true"
                        >
                          <span className={`status-badge ${form.status}`}>
                            {form.status === 'published'
                              ? '公開中'
                              : form.status === 'closed'
                                ? '受付終了'
                                : '下書き'}
                          </span>
                          <div className="card-paper">
                            <PdfPage url={`/api/forms/${form.id}/pdf`} size={form.pages[0]} />
                            {form.draft.fields.slice(0, 4).map(
                              (field) =>
                                field.page === 0 && (
                                  <span
                                    key={field.id}
                                    className="mini-field"
                                    style={{
                                      left: `${field.x * 100}%`,
                                      top: `${field.y * 100}%`,
                                      width: `${field.width * 100}%`,
                                      height: `${field.height * 100}%`,
                                    }}
                                  />
                                ),
                            )}
                          </div>
                          <span className="preview-pages">
                            <FileText size={11} />
                            {form.pages.length}ページ
                          </span>
                        </Link>
                        <div className="card-info">
                          <div className="card-title-row">
                            <Link href={`/forms/${form.id}`}>
                              <h3>{form.title}</h3>
                            </Link>
                            <FormMenu
                              form={form}
                              open={menu === form.id}
                              onToggle={() => setMenu(menu === form.id ? null : form.id)}
                              onRemove={() => setRemove(form)}
                              onCopy={() => copyLink(form)}
                            />
                          </div>
                          <div className="card-meta">
                            <span>
                              <Clock3 size={12} />
                              {formatDate(form.updatedAt)}
                            </span>
                            <Link href={`/forms/${form.id}/responses`}>
                              <Inbox size={13} />
                              {form.responseCount} 件の回答
                            </Link>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          {section === 'responses' && (
            <section className="response-panel">
              {!responses ? (
                <Spinner />
              ) : responses.length === 0 ? (
                <Empty
                  title="最初の回答を待っています"
                  description="フォームを公開してリンクを共有すると、ここに回答が届きます。"
                >
                  <button className="button primary" onClick={() => setSection('forms')}>
                    フォームを見る
                    <ArrowRight size={15} />
                  </button>
                </Empty>
              ) : (
                <div className="response-table">
                  <table>
                    <thead>
                      <tr>
                        <th>フォーム・回答者</th>
                        <th>送信日時</th>
                        <th>バージョン</th>
                        <th>回答PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {responses.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.title}</strong>
                            <small>
                              {String(
                                Object.values(r.values).find((v) => typeof v === 'string' && v) ||
                                  '回答',
                              )}
                            </small>
                          </td>
                          <td>{formatDate(r.submittedAt)}</td>
                          <td>v{r.version}</td>
                          <td>
                            <a
                              className="button subtle small"
                              href={`/api/forms/${r.formId}/submissions/${r.id}/pdf`}
                            >
                              <ArrowDownToLine size={15} />
                              PDF
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination page={responsePage} total={responseTotal} onChange={setResponsePage} />
            </section>
          )}
        </main>
      </div>
      {modal === 'new' && (
        <Modal title="新しいフォームを作成" onClose={() => !busy && setModal(null)}>
          <div className="modal-body">
            <p className="muted">お手持ちのPDFに入力欄を配置して、フォームを作りましょう。</p>
            <button
              className={`upload-zone ${dragging ? 'dragging' : ''}`}
              disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) void create(file);
              }}
            >
              <span className="upload-icon">
                {busy ? <LoaderCircle className="spin" size={26} /> : <Upload size={26} />}
              </span>
              <strong>{busy ? 'フォームを準備しています…' : 'PDFをここにドロップ'}</strong>
              <span>またはクリックしてファイルを選択</span>
              <small>PDF形式・最大12MB・50ページまで</small>
            </button>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void create(file);
              }}
            />
            <div className="or-divider">
              <span>または</span>
            </div>
            <button className="sample-option" disabled={busy} onClick={() => create()}>
              <span>
                <Sparkles size={22} />
              </span>
              <div>
                <strong>サンプルPDFで試す</strong>
                <small>A4の受講申込書。氏名・連絡先などの入力欄を配置済みです。</small>
              </div>
              <ArrowRight size={18} />
            </button>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="Formeの使い方" onClose={() => setModal(null)}>
          <div className="modal-body guide-steps">
            {[
              [Upload, '01', 'PDFをアップロード', '申込書や申請書など、いつものPDFを選択します。'],
              [
                MousePointer2,
                '02',
                '入力欄を配置',
                'テキスト・日付・チェック欄を追加し、PDFに合わせて移動・サイズ調整します。',
              ],
              [Send, '03', 'リンクを共有', '保存して公開すると、回答用のURLが発行されます。'],
              [
                ArrowDownToLine,
                '04',
                '回答をPDFで受け取る',
                '送信された回答は一覧に保存され、記入済みPDFを出力できます。',
              ],
            ].map(([Icon, n, title, description]) => {
              const I = Icon as typeof Upload;
              return (
                <div className="guide-step" key={String(n)}>
                  <span>
                    <I size={22} />
                  </span>
                  <div>
                    <small>STEP {String(n)}</small>
                    <h3>{String(title)}</h3>
                    <p>{String(description)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === 'workspace' && (
        <Modal title="マイワークスペース" onClose={() => setModal(null)}>
          <div className="modal-body">
            <div className="workspace-detail">
              <span className="workspace-avatar">M</span>
              <div>
                <h3>クラウドワークスペース</h3>
                <p>{email}</p>
              </div>
            </div>
            <div className="info-box">
              フォームと回答はアカウントに紐づけて保存されます。同じメールアドレスでログインすると、別の端末からも利用できます。
            </div>
            <p className="muted">
              PDFと回答は非公開で保存されます。公開したフォームと回答控えは、それぞれのURLを知っている人が閲覧できます。
            </p>
            <button
              className="button subtle full"
              onClick={async () => {
                const { error } = await browserSupabase().auth.signOut();
                if (error) {
                  toast('ログアウトできませんでした', true);
                  return;
                }
                location.href = '/login';
              }}
            >
              ログアウト
            </button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="フォームを削除しますか？" onClose={() => setRemove(null)}>
          <div className="modal-body">
            <p>
              「{remove.title}
              」の受付と閲覧を停止します。データは30日後に完全に削除されます。復元が必要な場合は、その前に管理者へお問い合わせください。
            </p>
            <div className="modal-actions">
              <button className="button subtle" onClick={() => setRemove(null)}>
                キャンセル
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  try {
                    await api(`/api/forms/${remove.id}`, { method: 'DELETE' });
                    setRemove(null);
                    await refresh();
                    toast('フォームを削除しました');
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                削除する
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function statusLabel(status: FormRecord['status']) {
  return status === 'published' ? '公開中' : status === 'closed' ? '受付終了' : '下書き';
}

function FormMenu({
  form,
  open,
  onToggle,
  onRemove,
  onCopy,
}: {
  form: FormRecord;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="card-menu-wrap">
      <button
        className="icon-button"
        aria-label={`${form.title}の操作`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="dropdown">
          <Link href={`/forms/${form.id}/responses`}>回答を見る</Link>
          {form.token && (
            <>
              <button onClick={onCopy}>回答用URLをコピー</button>
              <a href={`/f/${form.token}`} target="_blank" rel="noreferrer">
                公開フォームを開く
              </a>
            </>
          )}
          <button className="danger-text" onClick={onRemove}>
            フォームを削除
          </button>
        </div>
      )}
    </div>
  );
}
