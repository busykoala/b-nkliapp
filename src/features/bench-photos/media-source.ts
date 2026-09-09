/** OSM image tags sometimes contain a Commons description page or a map link. */
export function galleryImageUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  if (url.hostname === 'commons.wikimedia.org') {
    const pathTitle = url.pathname.match(/^\/wiki\/(?:File|Image):(.+)$/)?.[1];
    const title = pathTitle ?? (url.pathname === '/w/index.php' ? url.searchParams.get('title')?.match(/^(?:File|Image):(.+)$/)?.[1] : null);
    if (title) {
      let filename = title;
      try { filename = pathTitle ? decodeURIComponent(title) : title; } catch { /* Preserve a literal percent in a filename. */ }
      return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename.replaceAll(' ', '_'))}?width=1280`;
    }
  }
  if (url.hostname === 'maps.app.goo.gl' || url.hostname === 'maps.google.com'
    || url.hostname === 'goo.gl' && url.pathname.startsWith('/maps')
    || /(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname.startsWith('/maps')) return null;
  return value;
}
