import type { Note, NoteType } from '../types';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Matches any {{...}} token. Anki field names may contain spaces and most
 * punctuation, so the token body is anything but braces; section markers are
 * filtered out in the replacer and left for applyConditionals.
 */
const FIELD_TOKEN_RE = /\{\{([^{}]+)\}\}/g;

export function substituteFields(template: string, fields: Record<string, string>): string {
  return template.replace(FIELD_TOKEN_RE, (full, inner: string) => {
    // {{#Field}}, {{^Field}} and {{/Field}} belong to applyConditionals.
    if (/^[#^/]/.test(inner)) return full;

    // An Anki token is `filter:filter:FieldName`; the field name is the last segment.
    const segments = inner.split(':');
    const name = segments.pop()!.trim();
    const filters = segments.map((f) => f.trim());

    const raw = fields[name] ?? '';
    // `text:` strips markup. Any other filter (hint:, furigana:, …) is not
    // implemented, so fall back to the plain value rather than leaking the
    // raw template token into the rendered card.
    return filters.includes('text') ? raw.replace(/<[^>]*>/g, '') : raw;
  });
}

export function applyConditionals(template: string, fields: Record<string, string>): string {
  const conditionalRe = /\{\{([#^])([^{}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  let result = template;
  let match: RegExpExecArray | null;
  while ((match = conditionalRe.exec(result))) {
    const [full, kind, fieldName, inner] = match;
    const value = fields[fieldName] ?? '';
    const isEmpty = value.trim() === '';
    const keep = kind === '#' ? !isEmpty : isEmpty;
    result = result.slice(0, match.index) + (keep ? inner : '') + result.slice(match.index + full.length);
  }
  return result;
}

const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs;

export function renderCloze(fieldValue: string, activeClozeNumber: number, revealAnswer: boolean): string {
  return fieldValue.replace(CLOZE_RE, (_match, numStr: string, text: string, hint: string | undefined) => {
    const num = Number(numStr);
    if (num !== activeClozeNumber) return text;
    if (revealAnswer) return `<span class="cloze">${text}</span>`;
    return `<span class="cloze">[${hint ?? '...'}]</span>`;
  });
}

export function substituteCloze(
  template: string,
  fields: Record<string, string>,
  cardOrd: number,
  revealAnswer: boolean
): string {
  return template.replace(/\{\{cloze:([^{}]+)\}\}/g, (_match, name: string) => {
    const raw = fields[name.trim()] ?? '';
    return renderCloze(raw, cardOrd + 1, revealAnswer);
  });
}

const SOUND_RE = /\[sound:([^\]]+)\]/g;
const IMG_SRC_RE = /<img([^>]*)\ssrc="([^"]+)"/g;

export function rewriteMediaTokens(html: string, mediaUrlMap: Map<string, string>): string {
  let result = html.replace(SOUND_RE, (_match, filename: string) => {
    const url = mediaUrlMap.get(filename);
    if (!url) return '';
    return `<audio class="ankiduck-audio" data-autoplay="true" controls src="${url}"></audio>`;
  });
  result = result.replace(IMG_SRC_RE, (full: string, attrs: string, src: string) => {
    const url = mediaUrlMap.get(src);
    return url ? `<img${attrs} src="${url}"` : full;
  });
  return result;
}

export function wrapWithCss(html: string, css: string): string {
  const scopedCss = css.replace(/\.card\b/g, '.ankiduck-card');
  return `<style>${scopedCss}</style><div class="ankiduck-card">${html}</div>`;
}

export function renderTemplateString(
  template: string,
  fields: Record<string, string>,
  opts: { cardOrd: number; revealAnswer: boolean }
): string {
  let result = substituteCloze(template, fields, opts.cardOrd, opts.revealAnswer);
  result = applyConditionals(result, fields);
  result = substituteFields(result, fields);
  return result;
}

export function renderCard(
  note: Note,
  noteType: NoteType,
  cardOrd: number,
  mediaUrlMap: Map<string, string>
): { front: string; back: string } {
  const fieldMap: Record<string, string> = {};
  noteType.fields.forEach((name, i) => {
    fieldMap[name] = note.fields[i] ?? '';
  });

  const template = noteType.templates[cardOrd];
  const frontRaw = renderTemplateString(template.qfmt, fieldMap, { cardOrd, revealAnswer: false });
  const backRaw = renderTemplateString(
    template.afmt,
    { ...fieldMap, FrontSide: frontRaw },
    { cardOrd, revealAnswer: true }
  );

  const front = wrapWithCss(rewriteMediaTokens(frontRaw, mediaUrlMap), noteType.css);
  const back = wrapWithCss(rewriteMediaTokens(backRaw, mediaUrlMap), noteType.css);
  return { front, back };
}
