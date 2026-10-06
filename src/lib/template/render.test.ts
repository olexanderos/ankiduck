import { describe, it, expect } from 'vitest';
import {
  substituteFields,
  applyConditionals,
  renderCloze,
  referencedMediaFilenames,
  substituteCloze,
  rewriteMediaTokens,
  wrapWithCss,
  renderTemplateString,
  renderCard,
} from './render';
import type { Note, NoteType } from '../types';

describe('substituteFields', () => {
  it('substitutes a plain field', () => {
    expect(substituteFields('{{Front}}', { Front: 'hej' })).toBe('hej');
  });

  it('inserts field HTML unescaped', () => {
    expect(substituteFields('{{Front}}', { Front: '<b>hej</b>' })).toBe('<b>hej</b>');
  });

  it('substitutes multiple distinct fields', () => {
    expect(substituteFields('{{Front}} - {{Back}}', { Front: 'a', Back: 'b' })).toBe('a - b');
  });

  it('renders empty string for a missing field', () => {
    expect(substituteFields('{{Missing}}', {})).toBe('');
  });

  it('strips HTML tags for {{text:Field}}', () => {
    expect(substituteFields('{{text:Front}}', { Front: '<b>hej</b> då' })).toBe('hej då');
  });

  // Real Anki decks routinely use field names containing spaces.
  it('substitutes a field whose name contains spaces', () => {
    expect(substituteFields('{{Swedish Sentence}}', { 'Swedish Sentence': 'Blod och tårar.' })).toBe(
      'Blod och tårar.'
    );
  });

  it('strips HTML for {{text:Field}} when the field name contains spaces', () => {
    expect(substituteFields('{{text:Swedish Sentence}}', { 'Swedish Sentence': '<b>hej</b>' })).toBe('hej');
  });

  it('falls back to the plain field value for an unsupported filter', () => {
    expect(substituteFields('{{hint:English}}', { English: 'and' })).toBe('and');
  });

  it('leaves conditional section markers for applyConditionals to handle', () => {
    expect(substituteFields('{{#Extra}}x{{/Extra}}', { Extra: 'y' })).toBe('{{#Extra}}x{{/Extra}}');
  });
});

describe('applyConditionals', () => {
  it('keeps a {{#Field}} section when the field is non-empty', () => {
    expect(applyConditionals('{{#Front}}shown{{/Front}}', { Front: 'x' })).toBe('shown');
  });

  it('drops a {{#Field}} section when the field is empty', () => {
    expect(applyConditionals('{{#Front}}shown{{/Front}}', { Front: '' })).toBe('');
  });

  it('drops a {{#Field}} section when the field is missing', () => {
    expect(applyConditionals('{{#Front}}shown{{/Front}}', {})).toBe('');
  });

  it('keeps a {{^Field}} section when the field is empty', () => {
    expect(applyConditionals('{{^Front}}shown{{/Front}}', { Front: '' })).toBe('shown');
  });

  it('drops a {{^Field}} section when the field is non-empty', () => {
    expect(applyConditionals('{{^Front}}shown{{/Front}}', { Front: 'x' })).toBe('');
  });

  it('handles two independent conditional sections', () => {
    const tpl = '{{#A}}a{{/A}}{{#B}}b{{/B}}';
    expect(applyConditionals(tpl, { A: '1', B: '' })).toBe('a');
  });

  it('preserves surrounding text outside the conditional', () => {
    expect(applyConditionals('before {{#A}}mid{{/A}} after', { A: '1' })).toBe('before mid after');
  });

  it('handles a conditional on a field name containing spaces', () => {
    expect(
      applyConditionals('{{#Swedish Sentence}}shown{{/Swedish Sentence}}', { 'Swedish Sentence': 'x' })
    ).toBe('shown');
  });
});

describe('renderCloze', () => {
  it('blanks the active cloze when not revealing', () => {
    expect(renderCloze('{{c1::Paris}} is the capital', 1, false)).toBe(
      '<span class="cloze">[...]</span> is the capital'
    );
  });

  it('reveals the active cloze when revealing', () => {
    expect(renderCloze('{{c1::Paris}} is the capital', 1, true)).toBe(
      '<span class="cloze">Paris</span> is the capital'
    );
  });

  it('uses the hint text in place of "..." when blanked', () => {
    expect(renderCloze('{{c1::Paris::city}} is the capital', 1, false)).toBe(
      '<span class="cloze">[city]</span> is the capital'
    );
  });

  it('always reveals clozes that are not the active number', () => {
    expect(renderCloze('{{c1::Paris}} is in {{c2::France}}', 1, false)).toBe(
      '<span class="cloze">[...]</span> is in France'
    );
  });
});

describe('substituteCloze', () => {
  it('resolves a {{cloze:Field}} token using cardOrd + 1 as the active cloze number', () => {
    const result = substituteCloze('{{cloze:Text}}', { Text: '{{c2::Paris}}' }, 1, true);
    expect(result).toBe('<span class="cloze">Paris</span>');
  });

  it('resolves a cloze token on a field name containing spaces', () => {
    const result = substituteCloze('{{cloze:Cloze Field}}', { 'Cloze Field': '{{c1::Paris}}' }, 0, true);
    expect(result).toBe('<span class="cloze">Paris</span>');
  });
});

describe('rewriteMediaTokens', () => {
  it('replaces a [sound:] token with a replay button carrying the resolved URL', () => {
    const map = new Map([['hej.mp3', 'blob:abc']]);
    expect(rewriteMediaTokens('[sound:hej.mp3]', map)).toBe(
      '<button type="button" class="ankiduck-sound" data-sound="blob:abc" aria-label="Play audio">🔊</button>'
    );
  });

  it('drops a [sound:] token whose file is not in the media map', () => {
    expect(rewriteMediaTokens('[sound:missing.mp3]', new Map())).toBe('');
  });

  it('rewrites an <img src> to the resolved URL', () => {
    const map = new Map([['cat.png', 'blob:xyz']]);
    expect(rewriteMediaTokens('<img src="cat.png">', map)).toBe('<img src="blob:xyz">');
  });
});

describe('wrapWithCss', () => {
  it('scopes .card selectors to .ankiduck-card and wraps the content', () => {
    const result = wrapWithCss('hello', '.card { color: red; }');
    expect(result).toBe('<style>.ankiduck-card { color: red; }</style><div class="ankiduck-card">hello</div>');
  });
});

describe('renderTemplateString', () => {
  it('applies cloze, then conditionals, then field substitution in order', () => {
    const result = renderTemplateString(
      '{{#Extra}}{{Extra}}{{/Extra}}{{cloze:Text}}',
      { Text: '{{c1::Paris}}', Extra: 'note' },
      { cardOrd: 0, revealAnswer: true }
    );
    expect(result).toBe('note<span class="cloze">Paris</span>');
  });
});

describe('renderCard', () => {
  const noteType: NoteType = {
    mid: 1,
    name: 'Basic',
    fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }],
    css: '.card { color: black; }',
    isCloze: false,
  };
  const note: Note = { nid: 1, mid: 1, guid: 'g1', fields: ['hej', 'hello'] };

  it('renders the front from qfmt', () => {
    const { front } = renderCard(note, noteType, 0, new Map());
    expect(front).toContain('hej');
    expect(front).not.toContain('hello');
  });

  it('renders the back with FrontSide composed in', () => {
    const { back } = renderCard(note, noteType, 0, new Map());
    expect(back).toContain('hej');
    expect(back).toContain('<hr>');
    expect(back).toContain('hello');
  });

  it('wraps both sides in the note type CSS', () => {
    const { front } = renderCard(note, noteType, 0, new Map());
    expect(front).toContain('<style>.ankiduck-card { color: black; }</style>');
  });
});

describe('referencedMediaFilenames', () => {
  it('collects sound and image filenames across all fields, without duplicates', () => {
    const fields = ['Hej [sound:hej.mp3]', '<img src="a.jpg"> [sound:hej.mp3]', '[sound:b.mp3]'];
    expect(referencedMediaFilenames(fields).sort()).toEqual(['a.jpg', 'b.mp3', 'hej.mp3']);
  });

  it('returns nothing for fields without media', () => {
    expect(referencedMediaFilenames(['plain', ''])).toEqual([]);
  });
});
