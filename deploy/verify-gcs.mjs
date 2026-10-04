import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
const bucket = new Storage().bucket(process.env.GCS_BUCKET);
const source = bucket.file(`verification/${randomUUID()}/private.txt`);
const published = bucket.file(source.name.replace('private.txt', 'published.txt'));
try {
  await source.save('tingyu-storage-verification', { resumable: false });
  await source.copy(published);
  const [url] = await published.getSignedUrl({ action: 'read', expires: Date.now() + 120000 });
  const result = await fetch(url);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'tingyu-storage-verification');
  const publicResult = await fetch(`https://storage.googleapis.com/${bucket.name}/${published.name}`);
  assert.equal(publicResult.status, 403);
  await published.delete();
  assert.equal((await fetch(url)).status, 404);
  console.log('GCS_UPLOAD_COPY_SIGN_PRIVATE_DELETE_VERIFIED');
} finally {
  await Promise.all([source.delete({ ignoreNotFound: true }), published.delete({ ignoreNotFound: true })]);
}

