import React from 'react';
import { useSession } from '../client/SessionProvider.tsx';
import { ImageViewer } from './ImageViewer.tsx';
import { closeViewerState, openViewerState, type ViewerRequest, type ViewerState } from './viewerHostState.ts';

const Ctx = React.createContext<(r: ViewerRequest) => void>(() => {});
export const useOpenViewer = () => React.useContext(Ctx);

/**
 * The one full-screen viewer, mounted at the app root inside the session, outside every row and Pressable,
 * so a tap in the viewer never reaches a message row. Closes if the open Kehila changes.
 */
export function ViewerHost({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const [open, setOpen] = React.useState<ViewerState>(null);
  const openViewer = React.useCallback((r: ViewerRequest) => setOpen(s => openViewerState(s, r)), []);
  React.useEffect(() => { if (open && open.k !== state.kehilaId) setOpen(closeViewerState); }, [open, state.kehilaId]);
  return (
    <Ctx.Provider value={openViewer}>
      {children}
      {open ? <ImageViewer key={`${open.k}:${open.messageId}`} messageId={open.messageId} contentType={open.contentType} onClose={() => setOpen(closeViewerState)} /> : null}
    </Ctx.Provider>
  );
}
