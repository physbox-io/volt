import { createContext, useContext } from 'react';
import type { CoSimChannel, LinkStatus } from '../utils/coSimLink';

/** The linked Mesh scene, for the inspector's channel pickers. */
export type MeshLinkInfo = { status: LinkStatus; channels: CoSimChannel[]; scene: string };

export const MeshLinkContext = createContext<MeshLinkInfo>({ status: 'closed', channels: [], scene: '' });

export const useMeshLinkInfo = () => useContext(MeshLinkContext);
