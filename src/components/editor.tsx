'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Inbox,
  Link2,
  LoaderCircle,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  CalendarDays,
  AtSign,
  AlignLeft,
} from 'lucide-react';
import { api } from '@/lib/client';
import {
  clampRect,
  fieldNames,
  fieldTypes,
  type Definition,
  type Field,
  type FieldType,
  type FormRecord,
} from '@/lib/domain';
import { Brand, Modal, Spinner, useToast } from './ui';
import { PdfPage } from './pdf-page';

const icons = {
  text: Type,
  textarea: AlignLeft,
  email: AtSign,
  date: CalendarDays,
  checkbox: CheckSquare2,
};
type Gesture = {
  field: Field;
  x: number;
  y: number;
  width: number;
  height: number;
  resize: boolean;
  before: Definition;
};

export function Editor({ id }: { id: string }) {
  const toast = useToast();
  const [record, setRecord] = useState<FormRecord | null>(null),
    recordRef = useRef<FormRecord | null>(null);
  const [draft, setDraftState] = useState<Definition | null>(null),
    draftRef = useRef<Definition | null>(null);
  const saved = useRef(''),
    pending = useRef<Promise<FormRecord> | null>(null);
  const past = useRef<Definition[]>([]),
    future = useRef<Definition[]>([]);
  const [historyTick, setHistoryTick] = useState(0),
    [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0),
    [zoom, setZoom] = useState(100),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState('');
  const [error, setError] = useState(''),
    [share, setShare] = useState(false),
    [publishing, setPublishing] = useState(false),
    [copied, setCopied] = useState(false);
  const [inspectingForm, setInspectingForm] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(595);
  const setDraft = useCallback((value: Definition) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);
  const commit = useCallback(
    (value: Definition) => {
      if (!draftRef.current || JSON.stringify(draftRef.current) === JSON.stringify(value)) return;
      past.current.push(draftRef.current);
      if (past.current.length > 80) past.current.shift();
      future.current = [];
      setDraft(value);
      setHistoryTick((t) => t + 1);
    },
    [setDraft],
  );
  const updateField = useCallback(
    (fieldId: string, changes: Partial<Field>) => {
      const d = draftRef.current;
      if (d)
        commit({
          ...d,
          fields: d.fields.map((f) => (f.id === fieldId ? { ...f, ...changes } : f)),
        });
    },
    [commit],
  );
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous && draftRef.current) {
      future.current.push(draftRef.current);
      setDraft(previous);
      setHistoryTick((t) => t + 1);
    }
  }, [setDraft]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next && draftRef.current) {
      past.current.push(draftRef.current);
      setDraft(next);
      setHistoryTick((t) => t + 1);
    }
  }, [setDraft]);

  useEffect(() => {
    api<FormRecord>(`/api/forms/${id}`)
      .then((data) => {
        recordRef.current = data;
        setRecord(data);
        setDraft(data.draft);
        saved.current = JSON.stringify(data.draft);
      })
      .catch((e) => setError(e.message));
  }, [id, setDraft]);
  useEffect(() => {
    const element = scrollArea.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(element);
      setPageWidth(
        Math.max(
          100,
          Math.min(
            595,
            element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          ),
        ),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [record]);

  const save = useCallback(async (): Promise<FormRecord> => {
    if (pending.current) return pending.current;
    const current = recordRef.current!,
      definition = draftRef.current!;
    if (JSON.stringify(definition) === saved.current) return current;
    setSaving(true);
    setSaveError('');
    const promise = api<FormRecord>(`/api/forms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ definition, revision: current.revision }),
    });
    pending.current = promise;
    try {
      const next = await promise;
      recordRef.current = next;
      setRecord(next);
      saved.current = JSON.stringify(definition);
      return next;
    } catch (e) {
      setSaveError((e as Error).message);
      throw e;
    } finally {
      pending.current = null;
      setSaving(false);
    }
  }, [id]);
  useEffect(() => {
    if (!draft || saving || saveError || gesture.current || JSON.stringify(draft) === saved.current)
      return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 1100);
    return () => clearTimeout(timer);
  }, [draft, saving, saveError, save, historyTick]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (draftRef.current && JSON.stringify(draftRef.current) !== saved.current)
        event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const removeSelected = useCallback(() => {
    if (draftRef.current && selected) {
      commit({
        ...draftRef.current,
        fields: draftRef.current.fields.filter((f) => f.id !== selected),
      });
      setSelected(null);
    }
  }, [selected, commit]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          'input, textarea, select, [contenteditable="true"], dialog',
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
      }
      const f = draftRef.current?.fields.find((f) => f.id === selected);
      if (f && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1,
          size = recordRef.current!.pages[f.page];
        updateField(
          f.id,
          clampRect({
            ...f,
            x:
              f.x +
              (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) /
                size.width,
            y:
              f.y +
              (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) /
                size.height,
          }),
        );
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [undo, redo, removeSelected, selected, updateField]);

  function add(type: FieldType, x = 0.15, y = 0.18 + ((draft?.fields.length || 0) % 8) * 0.06) {
    const d = draftRef.current;
    if (!d) return;
    if (d.fields.length >= 100) {
      toast('入力欄は100個までです', true);
      return;
    }
    const field: Field = {
      id: crypto.randomUUID(),
      type,
      label: fieldNames[type],
      page,
      required: false,
      placeholder: '',
      ...clampRect({
        x,
        y,
        width: type === 'checkbox' ? 0.04 : 0.5,
        height: type === 'textarea' ? 0.11 : type === 'checkbox' ? 0.03 : 0.038,
      }),
    };
    commit({ ...d, fields: [...d.fields, field] });
    setSelected(field.id);
    setInspectingForm(false);
  }
  function start(event: PointerEvent<HTMLElement>, field: Field, resize = false) {
    if (publishing) return;
    event.stopPropagation();
    event.preventDefault();
    setSelected(field.id);
    setInspectingForm(false);
    const rect = stage.current!.getBoundingClientRect();
    gesture.current = {
      field,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      resize,
      before: draftRef.current!,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || !draftRef.current) return;
    const dx = (event.clientX - g.x) / g.width,
      dy = (event.clientY - g.y) / g.height;
    const rect = clampRect(
      g.resize
        ? {
            ...g.field,
            width: Math.min(1 - g.field.x, g.field.width + dx),
            height: Math.min(1 - g.field.y, g.field.height + dy),
          }
        : { ...g.field, x: g.field.x + dx, y: g.field.y + dy },
    );
    setDraft({
      ...draftRef.current,
      fields: draftRef.current.fields.map((f) => (f.id === g.field.id ? { ...f, ...rect } : f)),
    });
  }
  function end() {
    const g = gesture.current;
    if (g && JSON.stringify(g.before) !== JSON.stringify(draftRef.current)) {
      past.current.push(g.before);
      future.current = [];
      setHistoryTick((t) => t + 1);
    }
    gesture.current = null;
  }
  async function flush() {
    let result = await save();
    while (JSON.stringify(draftRef.current) !== saved.current) result = await save();
    return result;
  }
  async function publish() {
    setPublishing(true);
    try {
      const current = await flush();
      const next = await api<FormRecord>(`/api/forms/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ revision: current.revision }),
      });
      recordRef.current = next;
      setRecord(next);
      setShare(true);
      toast('フォームを公開しました');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPublishing(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/f/${record!.token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('URLを選択してコピーしてください', true);
    }
  }
  if (error)
    return (
      <div className="standalone-state">
        <Brand />
        <h1>フォームを開けませんでした</h1>
        <p>{error}</p>
        <Link className="button primary" href="/">
          ホームへ戻る
        </Link>
      </div>
    );
  if (!record || !draft) return <Spinner label="編集画面を準備しています…" />;
  const field = draft.fields.find((f) => f.id === selected),
    size = record.pages[page];
  const dirty = JSON.stringify(draft) !== saved.current;
  return (
    <div className="editor-shell">
      <header className="editor-header">
        <Link
          href="/"
          className="button subtle back-link"
          aria-label="フォーム一覧へ戻る"
          onClick={(event) => {
            if (dirty) {
              event.preventDefault();
              void flush()
                .then(() => {
                  location.href = '/';
                })
                .catch((e) => toast(e.message, true));
            }
          }}
        >
          <ArrowLeft size={20} />
          <span>一覧へ</span>
        </Link>
        <div className="header-divider" />
        <Brand small />
        <div className="editor-title">
          <input
            aria-label="フォーム名"
            value={draft.title}
            maxLength={100}
            onChange={(e) => commit({ ...draft, title: e.target.value })}
          />
          <span className={`save-indicator ${saveError ? 'failed' : ''}`}>
            {saving ? (
              <>
                <LoaderCircle size={11} className="spin" />
                保存中
              </>
            ) : saveError ? (
              '保存できませんでした'
            ) : dirty ? (
              <>
                <span />
                未保存の変更
              </>
            ) : (
              <>
                <Check size={12} />
                保存済み
              </>
            )}
          </span>
        </div>
        <div className="editor-header-actions">
          <button
            className="button subtle small editor-save"
            disabled={saving}
            onClick={() =>
              flush()
                .then(() => toast('保存しました'))
                .catch((e) => toast(e.message, true))
            }
          >
            <Save size={15} />
            保存
          </button>
          <button
            className="button subtle small"
            onClick={async () => {
              const preview = window.open('about:blank', '_blank');
              try {
                await flush();
                if (preview) preview.location.href = `/forms/${id}/preview`;
                else location.href = `/forms/${id}/preview`;
              } catch (e) {
                preview?.close();
                toast((e as Error).message, true);
              }
            }}
          >
            <Eye size={15} />
            <span>プレビュー</span>
          </button>
          {record.token && (
            <button
              className="button subtle small"
              onClick={() => setShare(true)}
              aria-label="共有設定"
            >
              <Link2 size={16} />
              <span>共有</span>
            </button>
          )}
          <button
            className="button primary small"
            disabled={publishing || !draft.fields.length}
            onClick={publish}
          >
            {publishing ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
            {record.publishedRevision ? '公開を更新' : '公開する'}
          </button>
        </div>
      </header>
      <div className="editor-subbar">
        <div className="editor-tabs">
          <span className="active">
            <MousePointer2 size={14} />
            フォームを編集
          </span>
          <Link href={`/forms/${id}/responses`}>
            <Inbox size={14} />
            回答<span>{record.responseCount}</span>
          </Link>
        </div>
        <span className="editor-subhint">
          {record.publishedRevision
            ? '編集内容は、公開を更新すると反映されます。'
            : '入力欄を配置したら、プレビューして公開しましょう。'}
        </span>
      </div>
      {saveError && (
        <div className="error-banner">
          {saveError}
          <button
            onClick={() => {
              setSaveError('');
              void save().catch(() => {});
            }}
          >
            再試行
          </button>
          <button onClick={() => location.reload()}>再読み込み</button>
        </div>
      )}
      <div className="editor-workspace">
        <aside className="field-palette">
          <div className="panel-heading">
            <h2>入力欄を追加</h2>
            <span>{draft.fields.length}/100</span>
          </div>
          <p>クリック、またはPDFにドラッグ</p>
          <div className="palette-items">
            {fieldTypes.map((type) => {
              const Icon = icons[type];
              return (
                <button
                  key={type}
                  className="palette-item"
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData('application/forme-field', type)
                  }
                  onClick={() => add(type)}
                >
                  <span>
                    <Icon size={18} strokeWidth={1.7} />
                  </span>
                  {fieldNames[type]}
                  <Plus size={14} />
                </button>
              );
            })}
          </div>
          <div className="palette-separator" />
          <div className="panel-heading">
            <h2>配置した入力欄</h2>
            <span>{draft.fields.length}</span>
          </div>
          <div className="field-list">
            {draft.fields.length ? (
              draft.fields.map((f, index) => {
                const Icon = icons[f.type];
                return (
                  <button
                    key={f.id}
                    className={selected === f.id ? 'active' : ''}
                    onClick={() => {
                      setSelected(f.id);
                      setPage(f.page);
                      setInspectingForm(false);
                    }}
                  >
                    <span className="field-list-number">{String(index + 1).padStart(2, '0')}</span>
                    <Icon size={14} />
                    <span>{f.label || '名称未設定'}</span>
                    {f.required && <i />}
                  </button>
                );
              })
            ) : (
              <div className="palette-empty">
                <MousePointer2 size={22} />
                <p>
                  入力欄を追加すると
                  <br />
                  ここに表示されます。
                </p>
              </div>
            )}
          </div>
          <div className="palette-tip">
            <span>小さなヒント</span>
            <p>
              矢印キーで位置を微調整。
              <br />⌘ / Ctrl + Z で元に戻せます。
            </p>
          </div>
        </aside>
        <main className="editor-canvas-area">
          <div className="canvas-toolbar">
            <div className="pdf-filename">
              <FileTextIcon />
              {record.filename}
            </div>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                aria-label="元に戻す"
                disabled={!past.current.length}
                onClick={undo}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="やり直す"
                disabled={!future.current.length}
                onClick={redo}
              >
                <Redo2 size={16} />
              </button>
              <span className="toolbar-rule" />
              <button
                className="icon-button"
                aria-label="縮小"
                disabled={zoom <= 60}
                onClick={() => setZoom((z) => z - 10)}
              >
                <Minus size={15} />
              </button>
              <span className="zoom-value">{zoom}%</span>
              <button
                className="icon-button"
                aria-label="拡大"
                disabled={zoom >= 150}
                onClick={() => setZoom((z) => z + 10)}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div ref={scrollArea} className="canvas-scroll" onClick={() => setSelected(null)}>
            <div className="canvas-page-wrap" style={{ width: `${(pageWidth * zoom) / 100}px` }}>
              <div
                ref={stage}
                className="editor-stage"
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('application/forme-field'))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const type = event.dataTransfer.getData('application/forme-field') as FieldType;
                  if (!fieldTypes.includes(type)) return;
                  const r = event.currentTarget.getBoundingClientRect();
                  add(type, (event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height);
                }}
              >
                <PdfPage url={`/api/forms/${id}/pdf`} page={page} size={size}>
                  {draft.fields
                    .filter((f) => f.page === page)
                    .map((f) => {
                      const Icon = icons[f.type];
                      return (
                        <div
                          key={f.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${f.label}の入力欄`}
                          aria-pressed={selected === f.id}
                          className={`editor-field ${selected === f.id ? 'selected' : ''} ${f.type === 'checkbox' ? 'checkbox-field' : ''}`}
                          style={{
                            left: `${f.x * 100}%`,
                            top: `${f.y * 100}%`,
                            width: `${f.width * 100}%`,
                            height: `${f.height * 100}%`,
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={() => {
                            setSelected(f.id);
                            setInspectingForm(false);
                          }}
                          onPointerDown={(event) => start(event, f)}
                          onPointerMove={move}
                          onPointerUp={end}
                          onPointerCancel={end}
                        >
                          <span className="field-overlay-content">
                            <Icon size={Math.max(9, (12 * zoom) / 100)} />
                            <span>{f.label}</span>
                            {f.required && <em>*</em>}
                          </span>
                          {selected === f.id && (
                            <>
                              <span className="field-drag-label">{f.label}</span>
                              <span
                                className="resize-handle"
                                onPointerDown={(event) => start(event, f, true)}
                                onPointerMove={move}
                                onPointerUp={end}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                </PdfPage>
              </div>
            </div>
            {draft.fields.filter((f) => f.page === page).length === 0 && (
              <div className="canvas-hint">
                <MousePointer2 size={15} />
                左のメニューから入力欄を追加してください
              </div>
            )}
          </div>
          <div className="canvas-footer">
            <span>
              <ShieldCheck size={13} />
              元のPDFは変更されません
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="前のページ"
                disabled={page === 0}
                onClick={() => {
                  setPage((p) => p - 1);
                  setSelected(null);
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {page + 1} / {record.pages.length} ページ
              </span>
              <button
                className="icon-button"
                aria-label="次のページ"
                disabled={page + 1 === record.pages.length}
                onClick={() => {
                  setPage((p) => p + 1);
                  setSelected(null);
                }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </main>
        <aside className="inspector">
          <div className="panel-heading">
            <h2>{field && !inspectingForm ? '入力欄の設定' : 'フォーム設定'}</h2>
            <button
              className="icon-button"
              aria-label="フォーム設定を表示"
              onClick={() => setInspectingForm((v) => !v)}
            >
              <Settings2 size={16} />
            </button>
          </div>
          {field && !inspectingForm ? (
            <div className="inspector-body">
              <div className="field-type-badge">
                {(() => {
                  const Icon = icons[field.type];
                  return <Icon size={17} />;
                })()}
                {fieldNames[field.type]}
              </div>
              <label className="control-label">
                項目名
                <input
                  value={field.label}
                  maxLength={80}
                  onChange={(event) => updateField(field.id, { label: event.target.value })}
                />
              </label>
              {field.type !== 'checkbox' && field.type !== 'date' && (
                <label className="control-label">
                  入力のヒント
                  <textarea
                    rows={3}
                    value={field.placeholder}
                    maxLength={120}
                    onChange={(event) => updateField(field.id, { placeholder: event.target.value })}
                    placeholder="例：山田 太郎"
                  />
                </label>
              )}
              <div className="toggle-row">
                <div>
                  <strong>必須項目にする</strong>
                  <p>回答時に入力を必須にします</p>
                </div>
                <button
                  role="switch"
                  aria-checked={field.required}
                  aria-label="必須項目にする"
                  className={`toggle ${field.required ? 'on' : ''}`}
                  onClick={() => updateField(field.id, { required: !field.required })}
                >
                  <span />
                </button>
              </div>
              <div className="inspector-divider" />
              <div className="control-label">配置情報</div>
              <div className="position-grid">
                <div>
                  <small>左から</small>
                  <span>{Math.round(field.x * record.pages[field.page].width)} pt</span>
                </div>
                <div>
                  <small>上から</small>
                  <span>{Math.round(field.y * record.pages[field.page].height)} pt</span>
                </div>
                <div>
                  <small>幅</small>
                  <span>{Math.round(field.width * record.pages[field.page].width)} pt</span>
                </div>
                <div>
                  <small>高さ</small>
                  <span>{Math.round(field.height * record.pages[field.page].height)} pt</span>
                </div>
              </div>
              <p className="inspector-hint">
                入力欄をドラッグして移動。右下のハンドルでサイズを調整できます。
              </p>
              <div className="inspector-divider" />
              <button
                className="button subtle full"
                onClick={() => {
                  const clone = {
                    ...field,
                    id: crypto.randomUUID(),
                    ...clampRect({ ...field, x: field.x + 0.025, y: field.y + 0.035 }),
                  };
                  commit({ ...draft, fields: [...draft.fields, clone] });
                  setSelected(clone.id);
                }}
                disabled={draft.fields.length >= 100}
              >
                <Copy size={15} />
                入力欄を複製
              </button>
              <button className="button danger-subtle full" onClick={removeSelected}>
                <Trash2 size={15} />
                入力欄を削除
              </button>
            </div>
          ) : (
            <div className="inspector-body">
              <label className="control-label">
                フォーム名
                <input
                  value={draft.title}
                  maxLength={100}
                  onChange={(e) => commit({ ...draft, title: e.target.value })}
                />
              </label>
              <label className="control-label">
                フォームの説明
                <textarea
                  rows={6}
                  value={draft.description}
                  maxLength={500}
                  onChange={(e) => commit({ ...draft, description: e.target.value })}
                  placeholder="回答する方への案内を入力してください。"
                />
                <small>{draft.description.length}/500</small>
              </label>
              <div className="info-box">
                <Eye size={18} />
                <p>フォーム名と説明は、回答画面の上部に表示されます。</p>
              </div>
              <div className="inspector-divider" />
              <div className="inspector-guide">
                <span>
                  <MousePointer2 size={24} />
                </span>
                <h3>入力欄を選択して編集</h3>
                <p>PDF上の入力欄をクリックすると、項目名や必須設定を変更できます。</p>
              </div>
            </div>
          )}
        </aside>
      </div>
      {share && record.token && (
        <Modal title="フォームを共有" onClose={() => setShare(false)}>
          <div className="modal-body">
            <div className="share-success">
              <span>
                <Check size={23} />
              </span>
              <h3>
                {record.status === 'published'
                  ? '回答の受付を開始しました'
                  : '現在、受付を停止しています'}
              </h3>
              <p>このリンクを知っている方が回答できます。</p>
            </div>
            <label className="control-label">
              回答用リンク
              <div className="copy-input">
                <input
                  readOnly
                  value={`${typeof window !== 'undefined' ? location.origin : ''}/f/${record.token}`}
                  onFocus={(e) => e.target.select()}
                />
                <button aria-label="リンクをコピー" onClick={copy}>
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
            </label>
            <a
              className="button primary full"
              href={`/f/${record.token}`}
              target="_blank"
              rel="noreferrer"
            >
              回答フォームを開く
              <ExternalLink size={15} />
            </a>
            <p className="share-note">
              localhostのURLは、このサーバーに接続できる環境で利用できます。
            </p>
            <div className="inspector-divider" />
            <div className="toggle-row">
              <div>
                <strong>回答を受け付ける</strong>
                <p>オフにすると、新しい回答を停止します</p>
              </div>
              <button
                role="switch"
                aria-label="回答を受け付ける"
                aria-checked={record.status === 'published'}
                className={`toggle ${record.status === 'published' ? 'on' : ''}`}
                onClick={async () => {
                  try {
                    const next = await api<FormRecord>(`/api/forms/${id}/status`, {
                      method: 'POST',
                      body: JSON.stringify({
                        status: record.status === 'published' ? 'closed' : 'published',
                      }),
                    });
                    recordRef.current = next;
                    setRecord(next);
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                <span />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function FileTextIcon() {
  return (
    <svg width="15" height="17" viewBox="0 0 15 17" fill="none" aria-hidden="true">
      <path d="M3 1h6l4 4v11H2V1h1Z" stroke="currentColor" />
      <path d="M9 1v4h4M5 9h5M5 12h5" stroke="currentColor" />
    </svg>
  );
}
