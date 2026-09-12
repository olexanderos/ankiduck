export type View =
  | { name: 'deckList' }
  | { name: 'importing' }
  | { name: 'review'; deckIds: number[]; deckName: string };

class AppState {
  view = $state<View>({ name: 'deckList' });
}

export const appState = new AppState();
