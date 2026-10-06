const assert=require('node:assert/strict');
const sharp=require('sharp');
async function main(){
  const base='http://localhost:3001';
  for (const path of ['/logo%20seul.svg', '/logo_pathelix.svg']) {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, path);
    const svg = await response.text();
    const embedded = Buffer.from(svg.match(/base64,([^"]+)/)[1], 'base64');
    assert(embedded.equals(require('node:fs').readFileSync('public/logo-pathelix.png')));
    console.log(path + ': HTTP 200, current artwork verified');
  }
  for(const [asset,size] of [['logo-pathelix.png',512],['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180],['favicon.png',48]]){
    const res=await fetch(`${base}/${asset}?v=20261006`,{signal:AbortSignal.timeout(30000)});
    assert.equal(res.status,200,asset);
    const meta=await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    assert.equal(meta.width,size);assert.equal(meta.height,size);
    console.log(`${asset}: HTTP 200, ${size}x${size}`);
  }
  const url=encodeURIComponent('/logo-pathelix.png?v=20261006');
  const optimized=await fetch(`${base}/_next/image?url=${url}&w=96&q=75`,{signal:AbortSignal.timeout(30000)});
  assert.equal(optimized.status,200,'Next Image logo');
  const res=await fetch(`${base}/login`,{signal:AbortSignal.timeout(60000)});
  assert.equal(res.status,200);
  const html=await res.text();
  assert(html.includes('logo-pathelix.png'));
  assert(html.includes('favicon.png?v=20261006'));
  assert(html.includes('apple-touch-icon.png?v=20261006'));
  assert(!html.includes('logo%20seul.svg'));
  console.log('Login HTML, favicon, Apple icon and Next Image optimization verified.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
