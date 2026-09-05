import { useCallback, useEffect, useRef, useState } from 'react';
import type { CircuitPreset } from '../utils/storage';
import { presets as presetsMap } from '../utils/presets';

export interface NoteCard {
  id: string;
  markdown: string;
  minimized: boolean;
  x: number;
  y: number;
}

declare global {
  interface Window {
    /** The cards on screen. Set by useNoteCards, read by the MCP bridge. */
    _circuit_getNoteCards?: () => NoteCard[];
    _circuit_setNoteCards?: (cards: NoteCard[]) => void;
  }
}

interface UseNoteCardsArgs {
  selectedPreset: string;
  userPresets: Record<string, CircuitPreset>;
}

/** Note-card overlays. Auto-spawns the active preset's note card (if it has one) whenever the preset selection changes. */
export function useNoteCards({ selectedPreset, userPresets }: UseNoteCardsArgs) {
  const [noteCards, setNoteCards] = useState<NoteCard[]>([]);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  // Which preset — and which card text — the cards on screen were spawned for.
  // `userPresets` is a fresh object on every save, so without this the effect
  // below re-ran and reset the cards while the selection sat still, which would
  // wipe a card the MCP bridge had just written the moment anything touched the
  // preset list.
  const spawnedFor = useRef<string | null>(null);

  useEffect(() => {
    const allPresets = { ...presetsMap, ...userPresets };
    const preset = allPresets[selectedPreset];
    // Keyed on the card's text as well as the preset, so re-saving the preset
    // under its own name — which is how the MCP bridge updates one — puts the
    // new card up instead of leaving the old one standing. A card the bridge
    // wrote directly still survives, because that changes `noteCards` without
    // touching `preset.noteCard`.
    const spawnKey = `${selectedPreset}\u0000${preset?.noteCard ?? ''}`;
    if (spawnedFor.current === spawnKey) return;
    spawnedFor.current = spawnKey;
    if (preset && preset.noteCard) {
      const defaultX = Math.max(20, window.innerWidth - 300 - 256 - 20);
      setNoteCards([{
        id: `preset_note_${selectedPreset}`,
        markdown: preset.noteCard,
        // A 300px card is a corner of a desktop canvas and most of a phone's,
        // so on a narrow screen it arrives rolled up to its title bar. The note
        // is still there and one tap away — it just isn't standing in front of
        // the circuit it describes.
        minimized: window.innerWidth < 1024,
        x: defaultX,
        y: 20
      }]);
    } else {
      setNoteCards([]);
    }
  }, [selectedPreset, userPresets]);

  const toggleEdit = useCallback((id: string) => {
    setEditingCardId(prev => prev === id ? null : id);
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    setNoteCards(prev => prev.map(c => c.id === id ? { ...c, minimized: !c.minimized } : c));
  }, []);

  const updateMarkdown = useCallback((id: string, md: string) => {
    setNoteCards(prev => prev.map(c => c.id === id ? { ...c, markdown: md } : c));
  }, []);

  const closeCard = useCallback((id: string) => {
    setNoteCards(prev => prev.filter(c => c.id !== id));
  }, []);

  const moveCard = useCallback((id: string, x: number, y: number) => {
    setNoteCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c));
  }, []);

  /*
   * Cards could only arrive with a preset or through the MCP bridge, so once a
   * card was closed — or on a circuit built from scratch — there was no way
   * back to one from the app itself. Opens straight into edit mode, since an
   * empty card has nothing to read.
   */
  const addCard = useCallback(() => {
    const id = `note_${Date.now()}`;
    setNoteCards(prev => [...prev, {
      id,
      markdown: '# Note\n\n',
      minimized: false,
      // Offset per card so a second one does not land exactly on the first.
      x: Math.max(20, window.innerWidth - 300 - 256 - 20) - prev.length * 24,
      y: 20 + prev.length * 24,
    }]);
    setEditingCardId(id);
  }, []);

  // Reachable by the MCP bridge, the same way Mesh exposes its cards. Without
  // this an agent could only describe a circuit by saving it as a preset —
  // there was no way to card the circuit actually on the canvas.
  useEffect(() => {
    window._circuit_getNoteCards = () => noteCards;
    window._circuit_setNoteCards = (cards) => setNoteCards(cards);
    return () => {
      delete window._circuit_getNoteCards;
      delete window._circuit_setNoteCards;
    };
  }, [noteCards]);

  return { noteCards, editingCardId, toggleEdit, toggleMinimize, updateMarkdown, closeCard, moveCard, addCard };
}
