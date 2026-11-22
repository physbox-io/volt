import { describe, it, expect } from 'vitest';
import { parseVoltDeepLink, stripVoltDeepLinkSearch } from '../src/utils/deepLink';

describe('Volt deep-link parser', () => {
  it('parses valid preset, modal, live run flag, and tour flag', () => {
    expect(parseVoltDeepLink('?preset=timer555Blink&run=1')).toEqual({
      preset: 'timer555Blink',
      run: true,
    });
    expect(parseVoltDeepLink('?preset=sallenKeyFilter&open=bode')).toEqual({
      preset: 'sallenKeyFilter',
      open: 'bode',
    });
    expect(parseVoltDeepLink('?preset=timer555Blink&open=pcb&tour=1')).toEqual({
      preset: 'timer555Blink',
      open: 'pcb',
      tour: true,
    });
    expect(parseVoltDeepLink('?open=make')).toEqual({
      open: 'pcb',
    });
  });

  it('ignores unknown presets and invalid modal names', () => {
    expect(parseVoltDeepLink('')).toBeNull();
    expect(parseVoltDeepLink('?preset=not_a_circuit&open=bogus')).toBeNull();
  });

  it('strips consumed deep-link params while preserving unrelated query params and hash', () => {
    expect(
      stripVoltDeepLinkSearch('https://volt.physbox.io/?preset=timer555Blink&run=1&mcp=1#share=abc')
    ).toBe('/?mcp=1#share=abc');
    expect(stripVoltDeepLinkSearch('https://volt.physbox.io/?preset=sallenKeyFilter')).toBe('/');
  });
});
