export type Grade = 'again' | 'hard' | 'good' | 'easy';
export type Queue = 'new' | 'learning' | 'review' | 'relearning';

export interface Deck {
  did: number;
  name: string; // raw Anki deck name, e.g. "Swedish 8k::Verbs::Irregular"
  pathSegments: string[]; // name.split('::')
}

export interface NoteTypeTemplate {
  name: string;
  qfmt: string;
  afmt: string;
}

export interface NoteType {
  mid: number;
  name: string;
  fields: string[]; // field names, in order
  templates: NoteTypeTemplate[];
  css: string;
  isCloze: boolean;
}

export interface Note {
  nid: number;
  mid: number;
  guid: string;
  fields: string[]; // values, ordered to match NoteType.fields
}

export interface Card {
  cid: number;
  nid: number;
  did: number;
  ord: number; // index into the note type's templates array
}

export interface CardState {
  cid: number;
  queue: Queue;
  due: number; // ms timestamp
  ivl: number; // days (0 while in learning/relearning)
  ease: number;
  lapses: number;
  learningStep: number; // index into the active learning/relearning steps array
}

export interface MediaFile {
  filename: string;
  blob: Blob;
}

export interface ParsedApkg {
  decks: Deck[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  media: MediaFile[];
}
