import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/pdfjs', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdfjs/pdf.worker.min.mjs');
console.log('PDF.js worker ready');
