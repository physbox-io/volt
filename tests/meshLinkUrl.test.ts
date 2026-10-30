// The Mesh page a link opens is marked so Mesh serves it without the
// cross-origin isolation headers. Without the mark the browser cut Mesh off
// from this page and Link Mesh flipped back with nothing said.

import { describe, it, expect } from 'vitest';
import { meshBaseUrl, meshLinkUrl } from '../src/utils/coSimLink';

describe('meshLinkUrl', () => {
  it('marks the page as a Volt link, in development and in production', () => {
    expect(meshLinkUrl(meshBaseUrl({ hostname: 'localhost', protocol: 'http:' }))).toBe('http://localhost:5175/?link=volt');
    expect(meshLinkUrl(meshBaseUrl({ hostname: 'volt.physbox.io', protocol: 'https:' }))).toBe('https://mesh.physbox.io/?link=volt');
  });
});
