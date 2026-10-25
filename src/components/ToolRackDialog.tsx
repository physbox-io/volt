import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ToolRackModal } from '@physbox-io/ui';
import { DEFAULT_TOOL_RACK, RACK_PRESETS, cuttingDefaults, defaultToolRack } from '@physbox-io/machining';
import {
  canonicalToolId,
  loadSelectedToolIds,
  readToolRack,
  toolRackStore,
} from '../utils/pcbTooling';

/**
 * The tool rack, as the dialog every app shares.
 *
 * It edits the shared rack's own entries, so fields Volt has no use for — the
 * layer operations Etch files a bit under, a stepover — pass through an edit
 * made here untouched, and the next time Etch opens the rack they are still
 * there.
 *
 * Portalled to the body above the machine dialog it is opened from: that
 * dialog sits at the top of the modal stack, and the shared modal's own layer
 * is far below it.
 */
export const ToolRackDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // Mounted per open, so this re-reads storage each time: Etch in another tab,
  // or a sign-in pull, may have written the rack since it was last shown.
  const [rack, setRack] = useState(() => readToolRack());
  useEffect(() => toolRackStore.subscribe(setRack), []);

  /*
   * What a delete would orphan, in Volt's terms: the two pickers that hold a
   * bit by itself. Drills are chosen per hole size on each board, so no
   * standing selection names one.
   */
  const usedBy = (toolNumber: number): string[] => {
    const selected = loadSelectedToolIds();
    const uses: string[] = [];
    const isolation = rack.tools.find(t => t.uid === canonicalToolId(rack, 'isolation', selected.isolation));
    const profile = rack.tools.find(t => t.uid === canonicalToolId(rack, 'profile', selected.profile));
    if (isolation?.toolNumber === toolNumber) uses.push('Isolation (CAM tab)');
    if (profile?.toolNumber === toolNumber) uses.push('Board outline (CAM tab)');
    return uses;
  };

  return createPortal(
    <div className="relative z-[100001]">
      <ToolRackModal
        open
        onClose={onClose}
        tools={rack.tools}
        onChange={tools => toolRackStore.set(tools)}
        onReset={() => toolRackStore.set(defaultToolRack().tools)}
        defaultCount={DEFAULT_TOOL_RACK.length}
        presets={RACK_PRESETS}
        cuttingDefaults={cuttingDefaults}
        usedBy={usedBy}
        unsaved={!toolRackStore.lastSaveSucceeded()}
        note={
          'This rack is shared with Etch and Mesh through your account: an edit here is the rack ' +
          'they offer too. The CAM tab offers its V-bits for isolation, its flat end mills for the ' +
          'board outline and its drills for the holes.'
        }
      />
    </div>,
    document.body
  );
};
