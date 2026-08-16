import { useCallback, useEffect, useState } from 'react';
import type { CircuitPreset } from '../utils/storage';
import { presets as presetsMap } from '../utils/presets';

interface NoteCard {
  id: string;
  markdown: string;
  minimized: boolean;
  x: number;
  y: number;
}

interface UseNoteCardsArgs {
  selectedPreset: string;
  userPresets: Record<string, CircuitPreset>;
}

/** Note-card overlays. Auto-spawns the active preset's note card (if it has one) whenever the preset selection changes. */
export function useNoteCards({ selectedPreset, userPresets }: UseNoteCardsArgs) {
  const [noteCards, setNoteCards] = useState<NoteCard[]>([]);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  useEffect(() => {
    const allPresets = { ...presetsMap, ...userPresets };
    const preset = allPresets[selectedPreset];
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

  return { noteCards, editingCardId, toggleEdit, toggleMinimize, updateMarkdown, closeCard, moveCard };
}
