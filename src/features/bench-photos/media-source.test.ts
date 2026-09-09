import { describe, expect, it } from 'vitest';
import { galleryImageUrl } from './media-source';

describe('legacy photo sources', () => {
  it('loads the image behind an encoded Commons description page', () => {
    expect(galleryImageUrl('https://commons.wikimedia.org/wiki/File:Dorben_Dorfplatz_Brunnen_und_B%C3%A4nkli.jpg'))
      .toBe('https://commons.wikimedia.org/wiki/Special:Redirect/file/Dorben_Dorfplatz_Brunnen_und_B%C3%A4nkli.jpg?width=1280');
  });
  it('keeps real image URLs and their query parameters intact', () => {
    const url = 'https://upload.wikimedia.org/wikipedia/commons/3/32/bench.jpg?width=800';
    expect(galleryImageUrl(url)).toBe(url);
  });
  it('does not attempt to display maps or unsafe URLs as photos', () => {
    for (const url of ['https://maps.app.goo.gl/example', 'https://www.google.ch/maps/place/bench', 'javascript:alert(1)', 'not a url']) {
      expect(galleryImageUrl(url)).toBeNull();
    }
  });
});
