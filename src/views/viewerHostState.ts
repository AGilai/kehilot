export type ViewerRequest = { k: string; messageId: string; contentType?: string };
export type ViewerState = ViewerRequest | null;

/** One viewer at a time: opening replaces whatever is open. */
export const openViewerState = (_s: ViewerState, r: ViewerRequest): ViewerState => ({ ...r });
export const closeViewerState = (_s: ViewerState): ViewerState => null;
