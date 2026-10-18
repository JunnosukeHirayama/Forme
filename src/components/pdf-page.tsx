'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import type { PageSize } from '@/lib/domain';
import { LoaderCircle, FileWarning } from 'lucide-react';

let modulePromise: Promise<typeof import('pdfjs-dist')> | undefined;
function pdfjs() {
  return (modulePromise ||= import('pdfjs-dist').then((module) => {
    module.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    return module;
  }));
}
export function PdfPage({
  url,
  page = 0,
  size,
  children,
  className = '',
}: {
  url: string;
  page?: number;
  size: PageSize;
  children?: ReactNode;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0),
    [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.round(entries[0].contentRect.width)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width) return;
    let disposed = false,
      document: PDFDocumentProxy | undefined,
      loading: PDFDocumentLoadingTask | undefined,
      task: RenderTask | undefined;
    setFailed(false);
    setLoaded(false);
    const run = async () => {
      try {
        const module = await pdfjs();
        loading = module.getDocument({ url });
        document = await loading.promise;
        if (disposed) return;
        const pdfPage = await document.getPage(page + 1);
        if (disposed || !canvas.current) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({
          scale: (width / pdfPage.getViewport({ scale: 1 }).width) * ratio,
        });
        const target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        task = pdfPage.render({
          canvas: target,
          canvasContext: target.getContext('2d')!,
          viewport,
        });
        await task.promise;
        if (!disposed) setLoaded(true);
      } catch (error) {
        if (!disposed && (error as Error).name !== 'RenderingCancelledException') setFailed(true);
      } finally {
        if (disposed) await loading?.destroy();
      }
    };
    void run();
    return () => {
      disposed = true;
      task?.cancel();
      void loading?.destroy();
    };
  }, [url, page, width]);
  return (
    <div
      ref={container}
      className={`pdf-page ${className}`}
      style={
        {
          aspectRatio: `${size.width} / ${size.height}`,
          '--pdf-unit': width / size.width,
        } as CSSProperties
      }
    >
      <canvas ref={canvas} aria-label={`PDF ${page + 1}ページ目`} />
      {!loaded && !failed && (
        <div className="pdf-loading">
          <LoaderCircle className="spin" size={20} />
        </div>
      )}
      {failed && (
        <div className="pdf-loading pdf-failed">
          <FileWarning size={22} />
          <span>PDFを表示できませんでした</span>
          <button className="button subtle small" onClick={() => setWidth((w) => w + 0.001)}>
            再読み込み
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
