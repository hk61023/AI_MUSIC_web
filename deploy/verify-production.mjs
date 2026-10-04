// Explicit deployment acceptance: creates one synthetic track, then removes it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Storage } from '@google-cloud/storage';
import { wav, document } from '../tests/helpers.mjs';
const origin = process.env.SITE_ORIGIN;
assert.ok(origin?.startsWith('https://'));
const password = (await readFile(process.env.ADMIN_PASSWORD_FILE, 'utf8')).trim();
let cookie = '', id = '', published = false;
async function request(route, method='GET', body, authenticated=true, extra={}) {
  return fetch(origin + route, {
    method, redirect: 'manual', headers: { Origin: origin,
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
}
async function expect(route, method, body, code) {
  const result = await request(route, method, body);
  assert.equal(result.status, code, `${method} ${route}`);
  return result;
}
try {
  assert.equal((await request('/api/admin/catalog','GET',undefined,false)).status,401);
  const login=await expect('/api/admin/login','POST',{password},200);
  assert.match(login.headers.get('set-cookie'), /Secure/i);
  cookie=login.headers.get('set-cookie').split(';')[0];
  const doc={...document,title:'部署验收合成测试（非 AI 作品）',source:'本地合成样例',
    downloadAllowed:true,rightsConfirmed:true,rightsEvidence:'由验收脚本生成的正弦波，不包含第三方素材',
    licenseText:'部署验收专用测试音频',featured:false};
  id=(await (await expect('/api/admin/tracks','POST',doc,201)).json()).id;
  assert.match(id,/^[a-f0-9-]{36}$/);
  assert.equal((await request(`/api/tracks/${id}`,'GET',undefined,false)).status,404);
  const upload=new FormData(); upload.set('audio',new Blob([wav(3)],{type:'audio/wav'}),'verification.wav');
  await expect(`/api/admin/tracks/${id}/upload`,'POST',upload,202);
  let track;
  for(let i=0;i<120;i++){
    track=(await (await request('/api/admin/catalog')).json()).tracks.find(t=>t.id===id);
    if(track.processing==='ready')break;
    if(track.processing==='failed')throw Error(track.processingError);
    await new Promise(r=>setTimeout(r,500));
  }
  assert.equal(track.processing,'ready');
  const preview=await expect(`/api/admin/tracks/${id}/preview/audio`,'GET',undefined,302);
  assert.equal((await fetch(preview.headers.get('location'))).status,200);
  await expect(`/api/admin/tracks/${id}/publish`,'POST',undefined,200); published=true;
  const audio=await expect(`/media/${id}/audio`,'GET',undefined,302);
  const signed=audio.headers.get('location');
  await Promise.all(Array.from({length:20},async()=>{
    const response=await fetch(signed,{headers:{Range:'bytes=0-2047'}});
    assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,2048);
  }));
  const download=await expect(`/api/tracks/${id}/download`,'GET',undefined,302);
  const downloaded=await fetch(download.headers.get('location'));
  assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition'),/attachment/);
  await downloaded.arrayBuffer();
  await expect(`/api/admin/tracks/${id}/unpublish`,'POST',undefined,200);published=false;
  assert.equal((await request(`/media/${id}/audio`,'GET',undefined,false)).status,404);
  assert.equal((await request(`/api/tracks/${id}/download`,'GET',undefined,false)).status,404);
  assert.equal((await fetch(signed)).status,404);
  console.log('PRODUCTION_UPLOAD_PROCESS_PREVIEW_PUBLISH_20_RANGE_DOWNLOAD_UNPUBLISH_VERIFIED');
} finally {
  if(id){
    if(published)await request(`/api/admin/tracks/${id}/unpublish`,'POST');
    const bucket=new Storage().bucket(process.env.GCS_BUCKET);
    for(const prefix of [`private/${id}/`,`published/${id}/`]){
      const [files]=await bucket.getFiles({prefix});
      await Promise.all(files.map(f=>f.delete({ignoreNotFound:true})));
    }
    const db=new DatabaseSync(`${process.env.DATA_DIR}/music.sqlite`);
    const row=db.prepare('SELECT document FROM tracks WHERE id=?').get(id);
    if(row && JSON.parse(row.document).title==='部署验收合成测试（非 AI 作品）') {
      db.prepare('DELETE FROM tracks WHERE id=?').run(id);
      db.prepare('DELETE FROM events WHERE track_id=?').run(id);
    }
    db.close();
  }
  if(cookie)await request('/api/admin/logout','POST');
}
