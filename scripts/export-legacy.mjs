// Offline, read-only export. No browser session hashes are exported and no cloud data is changed.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const index = process.argv.indexOf('--workspace');
const workspace = index < 0 ? undefined : process.argv[index + 1];
if (!workspace || !/^[0-9a-f-]{36}$/i.test(workspace))
  throw new Error('対象の --workspace UUID を明示してください');
const database = new DatabaseSync(process.env.DATABASE_PATH || '.data/forme.sqlite', {
  readOnly: true,
});
const forms = database.prepare('select * from forms where workspace_id=?').all(workspace);
const destination = resolve(`tmp/legacy-export-${Date.now()}`);
await mkdir(destination, { recursive: true, mode: 0o700 });
const manifest = [];
for (const form of forms) {
  const { pdf, ...metadata } = form;
  await writeFile(`${destination}/${form.id}.pdf`, pdf, { mode: 0o600 });
  manifest.push({
    ...metadata,
    submissions: database.prepare('select * from submissions where form_id=?').all(form.id),
  });
}
await writeFile(
  `${destination}/manifest.json`,
  JSON.stringify({ version: 1, forms: manifest }, null, 2),
  { mode: 0o600 },
);
database.close();
console.log(`${forms.length}件を読み取り専用で書き出しました: ${destination}`);
console.log('回答と共有用トークンを含みます。公開リポジトリへ追加しないでください。');
