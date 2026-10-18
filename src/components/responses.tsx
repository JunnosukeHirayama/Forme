'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Inbox,
  Link2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api, formatDate } from '@/lib/client';
import type { FormRecord, SubmissionRecord, SubmissionPage } from '@/lib/domain';
import { Brand, Empty, Modal, Spinner, useToast, Pagination } from './ui';

export function Responses({ id }: { id: string }) {
  const toast = useToast();
  const [form, setForm] = useState<FormRecord | null>(null),
    [responses, setResponses] = useState<SubmissionRecord[] | null>(null);
  const [error, setError] = useState(''),
    [selected, setSelected] = useState<SubmissionRecord | null>(null),
    [search, setSearch] = useState('');
  const [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [exporting, setExporting] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const serial = ++generation.current;
    try {
      const [f, rows] = await Promise.all([
        api<FormRecord>(`/api/forms/${id}`),
        api<SubmissionPage>(
          `/api/forms/${id}/submissions?page=${page}&search=${encodeURIComponent(search)}`,
        ),
      ]);
      if (serial !== generation.current) return;
      setForm(f);
      setResponses(rows.items);
      setTotal(rows.total);
      setError('');
    } catch (e) {
      if (serial === generation.current) setError((e as Error).message);
    }
  }, [id, page, search]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 200);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [refresh]);
  async function exportCsv() {
    if (exporting || !form?.responseCount) return;
    setExporting(true);
    try {
      const all: SubmissionRecord[] = [];
      const before = encodeURIComponent(new Date().toISOString());
      for (let page = 0; page < 100; page++) {
        const result = await api<SubmissionPage>(
          `/api/forms/${id}/submissions?page=${page}&before=${before}`,
        );
        all.push(...result.items);
        if ((page + 1) * result.pageSize >= result.total) break;
      }
      const fields = new Map<string, string>();
      all.forEach((r) => r.definition.fields.forEach((f) => fields.set(f.id, f.label)));
      const quote = (value: unknown) => {
        let text = String(value ?? '');
        if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
      };
      const rows = [
        ['受付番号', '送信日時', 'バージョン', ...fields.values()],
        ...all.map((r) => [
          r.id,
          r.submittedAt,
          r.version,
          ...[...fields.keys()].map((key) =>
            typeof r.values[key] === 'boolean'
              ? r.values[key]
                ? 'はい'
                : 'いいえ'
              : (r.values[key] ?? ''),
          ),
        ]),
      ];
      const url = URL.createObjectURL(
        new Blob(['\uFEFF', rows.map((row) => row.map(quote).join(',')).join('\r\n')], {
          type: 'text/csv;charset=utf-8',
        }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form!.title}_回答.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setExporting(false);
    }
  }
  if (error)
    return (
      <div className="standalone-state">
        <h1>回答を読み込めませんでした</h1>
        <p>{error}</p>
        <button className="button primary" onClick={refresh}>
          再読み込み
        </button>
      </div>
    );
  if (!form || !responses) return <Spinner label="回答を読み込んでいます…" />;
  const shown = responses;
  return (
    <div className="responses-shell">
      <header className="editor-header">
        <Link href="/" className="button subtle back-link" aria-label="フォーム一覧へ戻る">
          <ArrowLeft size={20} />
          <span>一覧へ</span>
        </Link>
        <div className="header-divider" />
        <Brand small />
        <div className="editor-title">
          <strong>{form.title}</strong>
          <span className="save-indicator">回答の管理</span>
        </div>
        <Link className="button subtle small" href={`/forms/${id}`}>
          <ArrowLeft size={14} />
          フォームを編集
        </Link>
      </header>
      <main className="responses-main">
        <div className="breadcrumb">
          <Link href="/">フォーム</Link>
          <ChevronRight size={13} />
          <span>{form.title}</span>
          <ChevronRight size={13} />
          <strong>回答</strong>
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">FORM RESPONSES</div>
            <h1>
              届いた回答<span className="heading-dot">.</span>
            </h1>
            <p>回答内容を確認して、書類として受け取れます。</p>
          </div>
          <div className="heading-actions">
            <button className="button subtle" onClick={refresh}>
              <RefreshCw size={15} />
              更新
            </button>
            <button
              className="button primary"
              disabled={!form.responseCount || exporting}
              onClick={exportCsv}
            >
              <FileSpreadsheet size={16} />
              {exporting ? 'CSVを準備中…' : 'CSVを出力'}
            </button>
          </div>
        </div>
        <div className="responses-summary">
          <div>
            <span className="stat-icon orange">
              <Inbox size={23} />
            </span>
            <div>
              <small>回答数</small>
              <strong>
                {form.responseCount}
                <span>件</span>
              </strong>
            </div>
          </div>
          <div>
            <span className={`status-badge ${form.status}`}>
              {form.status === 'published'
                ? '回答を受付中'
                : form.status === 'closed'
                  ? '受付終了'
                  : '未公開'}
            </span>
            {form.token ? (
              <button
                className="text-button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(`${location.origin}/f/${form.token}`)
                    .then(() => toast('回答用リンクをコピーしました'))
                    .catch(() => toast('コピーできませんでした', true))
                }
              >
                <Link2 size={14} />
                回答用リンクをコピー
              </button>
            ) : (
              <Link className="text-button" href={`/forms/${id}`}>
                フォームを公開する
                <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>
        <section className="response-panel">
          <div className="response-panel-top">
            <h2>
              回答一覧<span>{form.responseCount}</span>
            </h2>
            <div className="search-input">
              <Search size={16} />
              <input
                aria-label="回答を検索"
                placeholder="回答内容を検索"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          {!form.responseCount ? (
            <Empty
              title="最初の回答を待っています"
              description="フォームのリンクを共有すると、ここに回答が届きます。"
            >
              {form.token && (
                <a
                  className="button subtle"
                  href={`/f/${form.token}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  回答画面を開く
                  <ExternalLink size={14} />
                </a>
              )}
            </Empty>
          ) : !shown.length ? (
            <Empty title="回答が見つかりません" description="別のキーワードで検索してください。" />
          ) : (
            <div className="response-table">
              <table>
                <thead>
                  <tr>
                    <th>回答者</th>
                    <th>メールアドレス</th>
                    <th>送信日時</th>
                    <th>回答PDF</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const name =
                      r.definition.fields.find((f) => /名前|氏名/.test(f.label)) ||
                      r.definition.fields.find((f) => f.type === 'text');
                    const email = r.definition.fields.find((f) => f.type === 'email');
                    return (
                      <tr key={r.id}>
                        <td>
                          <button className="respondent-name" onClick={() => setSelected(r)}>
                            <span>{String(name ? r.values[name.id] || '?' : '?').slice(0, 1)}</span>
                            <div>
                              <strong>
                                {name ? String(r.values[name.id] || '名前未入力') : '回答'}
                              </strong>
                              <small>#{r.id.slice(0, 8)}</small>
                            </div>
                          </button>
                        </td>
                        <td>{email ? String(r.values[email.id] || '—') : '—'}</td>
                        <td>{formatDate(r.submittedAt)}</td>
                        <td>
                          <a
                            className="button subtle small"
                            href={`/api/forms/${id}/submissions/${r.id}/pdf`}
                          >
                            <ArrowDownToLine size={14} />
                            PDFを保存
                          </a>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label="回答の詳細"
                            onClick={() => setSelected(r)}
                          >
                            <ChevronRight size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} total={total} onChange={setPage} />
        </section>
        <p className="responses-note">
          <Check size={13} />
          回答は送信時点のフォーム内容とともに保存されます。
        </p>
      </main>
      {selected && (
        <Modal title="回答の詳細" onClose={() => setSelected(null)}>
          <div className="modal-body">
            <div className="response-detail-meta">
              <span>#{selected.id.slice(0, 8).toUpperCase()}</span>
              <span>
                {formatDate(selected.submittedAt)} · v{selected.version}
              </span>
            </div>
            <dl className="response-details">
              {selected.definition.fields.map((f) => (
                <div key={f.id}>
                  <dt>{f.label}</dt>
                  <dd>
                    {typeof selected.values[f.id] === 'boolean'
                      ? selected.values[f.id]
                        ? '✓ はい'
                        : 'いいえ'
                      : String(selected.values[f.id] || '未入力')}
                  </dd>
                </div>
              ))}
            </dl>
            <a
              className="button primary full"
              href={`/api/forms/${id}/submissions/${selected.id}/pdf`}
            >
              <Download size={16} />
              記入済みPDFをダウンロード
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
