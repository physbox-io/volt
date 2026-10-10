import { createContext, useContext } from 'react';
import type { CoSimChannel, LinkStatus } from '../utils/coSimLink';

/**
 * The linked Mesh scene, for the inspector's channel pickers. `read` reads
 * output channels where the scene stands, without stepping it: how a setting
 * bound to a measurement (a speaker's box volume) takes its value.
 */
export type MeshLinkInfo = {
  status: LinkStatus;
  channels: CoSimChannel[];
  scene: string;
  read: (names: string[]) => Promise<Record<string, number>>;
};

export const MeshLinkContext = createContext<MeshLinkInfo>({
  status: 'closed', channels: [], scene: '', read: () => Promise.reject(new Error('Mesh is not linked.')),
});

export const useMeshLinkInfo = () => useContext(MeshLinkContext);
