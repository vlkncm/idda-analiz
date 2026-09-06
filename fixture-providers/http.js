'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { FixtureProviderError } = require('./base');

function isPrivateIp(address) {
  if (!net.isIP(address)) return false;
  if (address.includes(':')) {
    const value = address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value.startsWith('::ffff:127.');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function domainAllowed(host, domains) {
  return domains.map(item => String(item).trim().toLowerCase()).filter(Boolean).some(domain => host === domain || host.endsWith(`.${domain}`));
}

async function assertSafeUrl(value, allowedDomains = [], { allowHttp = false, lookup = dns.lookup } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new FixtureProviderError('Geçersiz kaynak adresi', { code: 'INVALID_URL' }); }
  const protocols = allowHttp ? new Set(['http:', 'https:']) : new Set(['https:']);
  if (!protocols.has(url.protocol) || url.username || url.password) throw new FixtureProviderError(`Kaynak adresi ${allowHttp ? 'HTTP veya HTTPS' : 'HTTPS'} olmalı ve kimlik bilgisi içermemeli`, { code: 'UNSAFE_URL' });
  const host = url.hostname.toLowerCase();
  if (!allowedDomains.length || !domainAllowed(host, allowedDomains)) throw new FixtureProviderError('Kaynak alan adı izin verilen listede değil', { code: 'DOMAIN_NOT_ALLOWED' });
  let addresses;
  try { addresses = await lookup(host, { all: true }); }
  catch { throw new FixtureProviderError('Kaynak alan adı çözümlenemedi', { code: 'DNS_ERROR', retryable: true }); }
  if (!addresses.length || addresses.some(row => isPrivateIp(row.address))) throw new FixtureProviderError('Özel veya yerel ağ adreslerine erişim engellendi', { code: 'PRIVATE_ADDRESS' });
  return url;
}

async function fetchResource(url, { headers = {}, timeoutMs = 12000, maxBytes = 2_000_000, allowedDomains = [], maxRedirects = 2, allowHttp = false, request = globalThis.fetch, lookup = dns.lookup } = {}) {
  let current = await assertSafeUrl(url, allowedDomains, { allowHttp, lookup });
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await request(current, { headers: { 'User-Agent': 'IDDA-Analiz-Merkezi/1.4', Accept: 'application/json, text/html;q=0.9, text/plain;q=0.8', ...headers }, redirect: 'manual', signal: controller.signal });
    } catch (error) {
      const timeout = error?.name === 'AbortError';
      throw new FixtureProviderError(timeout ? 'Veri kaynağı zaman aşımına uğradı' : 'Veri kaynağına bağlanılamadı', { code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', retryable: true });
    } finally { clearTimeout(timer); }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (redirects === maxRedirects) throw new FixtureProviderError('Kaynak çok fazla yönlendirme yaptı', { code: 'TOO_MANY_REDIRECTS' });
      current = await assertSafeUrl(new URL(response.headers.get('location'), current).toString(), allowedDomains, { allowHttp, lookup });
      continue;
    }
    if (!response.ok) throw new FixtureProviderError(`Veri kaynağı HTTP ${response.status} döndürdü`, { code: response.status === 429 ? 'RATE_LIMIT' : 'HTTP_ERROR', status: response.status, retryable: response.status === 429 || response.status >= 500 });
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new FixtureProviderError('Kaynak yanıtı boyut sınırını aştı', { code: 'RESPONSE_TOO_LARGE' });
    const reader = response.body?.getReader();
    let text;
    if (!reader) text = await response.text();
    else {
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new FixtureProviderError('Kaynak yanıtı boyut sınırını aştı', { code: 'RESPONSE_TOO_LARGE' }); }
        chunks.push(value);
      }
      text = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
    }
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new FixtureProviderError('Kaynak yanıtı boyut sınırını aştı', { code: 'RESPONSE_TOO_LARGE' });
    return { text, contentType: String(response.headers.get('content-type') || '').toLowerCase(), url: current.toString(), status: response.status };
  }
  throw new FixtureProviderError('Kaynak alınamadı', { code: 'FETCH_FAILED' });
}

async function fetchText(url, options) { return (await fetchResource(url, options)).text; }
function parseJson(text) { try { return JSON.parse(text); } catch { throw new FixtureProviderError('Veri kaynağı bozuk JSON döndürdü', { code: 'INVALID_JSON' }); } }
async function fetchJson(url, options) { return parseJson(await fetchText(url, options)); }

module.exports = { isPrivateIp, domainAllowed, assertSafeUrl, fetchResource, fetchText, parseJson, fetchJson };
