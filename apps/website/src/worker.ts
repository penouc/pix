/**
 * Static site worker: Assets for everything, plus Safari-safe MP4 Range (206).
 * HTML is served with no-store so deploys are not stuck behind a stale edge HIT.
 */
export interface Env {
  ASSETS: Fetcher;
}

function isMp4(pathname: string): boolean {
  return pathname.startsWith('/videos/') && pathname.endsWith('.mp4');
}

function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;

  const hasStart = match[1] !== '';
  const hasEnd = match[2] !== '';
  if (!hasStart && !hasEnd) return null;

  let start = hasStart ? Number(match[1]) : 0;
  let end = hasEnd ? Number(match[2]) : size - 1;

  if (!hasStart && hasEnd) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size) {
    return 'unsatisfiable';
  }

  end = Math.min(end, size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

function withHtmlCacheHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, must-revalidate');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function serveMp4(request: Request, env: Env, url: URL): Promise<Response> {
  const assetRequest = new Request(url.toString(), {
    method: 'GET',
    headers: (() => {
      const h = new Headers(request.headers);
      h.delete('Range');
      return h;
    })(),
  });

  const asset = await env.ASSETS.fetch(assetRequest);
  if (!asset.ok) return asset;

  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  const headers = new Headers();
  headers.set('Content-Type', 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=604800, immutable');
  const etag = asset.headers.get('etag');
  if (etag) headers.set('ETag', etag);

  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) {
    headers.set('Content-Length', String(size));
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(body, { status: 200, headers });
  }

  const parsed = parseRange(rangeHeader, size);
  if (parsed === null || parsed === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const { start, end } = parsed;
  const slice = body.slice(start, end + 1);
  headers.set('Content-Length', String(slice.byteLength));
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
  return new Response(slice, { status: 206, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if ((request.method === 'GET' || request.method === 'HEAD') && isMp4(url.pathname)) {
      return serveMp4(request, env, url);
    }

    const response = await env.ASSETS.fetch(request);
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return withHtmlCacheHeaders(response);
    return response;
  },
};
