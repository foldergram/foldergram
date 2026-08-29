export interface ReelPanelMetrics {
  id: number;
  offsetTop: number;
  offsetHeight: number;
}

export interface ReelsAffinitySnapshot {
  lastFolder: string | null;
  recentFolders: string[];
}

export function resolveReelsAffinitySnapshot(
  existingSnapshot: ReelsAffinitySnapshot | null,
  lastFolder: string | null,
  recentFolders: string[]
): ReelsAffinitySnapshot {
  if (existingSnapshot) {
    return existingSnapshot;
  }

  const normalizedLastFolder = typeof lastFolder === 'string' && lastFolder.trim().length > 0 ? lastFolder.trim() : null;
  const normalizedRecentFolders = recentFolders
    .map((folder) => folder.trim())
    .filter((folder, index, items) => folder.length > 0 && items.indexOf(folder) === index);

  return {
    lastFolder: normalizedLastFolder,
    recentFolders: normalizedLastFolder
      ? [normalizedLastFolder, ...normalizedRecentFolders.filter((folder) => folder !== normalizedLastFolder)]
      : normalizedRecentFolders
  };
}

export function getActiveReelId(
  panels: ReelPanelMetrics[],
  scrollTop: number,
  viewportHeight: number
): number | null {
  if (panels.length === 0) {
    return null;
  }

  const viewportCenter = scrollTop + viewportHeight / 2;
  let activePanel = panels[0] ?? null;
  let smallestOffset = Number.POSITIVE_INFINITY;

  for (const panel of panels) {
    const panelCenter = panel.offsetTop + panel.offsetHeight / 2;
    const centerOffset = Math.abs(panelCenter - viewportCenter);
    if (centerOffset < smallestOffset) {
      smallestOffset = centerOffset;
      activePanel = panel;
    }
  }

  return activePanel?.id ?? null;
}

/**
 * Cards whose stream should be warmed up while the current clip plays. Cold HLS
 * segments cost 1.2-1.5s of ffmpeg start-up on the NAS, so warming only the very
 * next card falls behind as soon as the user swipes several times in a row.
 */
export function getReelPrefetchIndexes(activeIndex: number, totalItems: number, lookahead = 4): Set<number> {
  if (activeIndex < 0 || totalItems <= 0) {
    return new Set<number>();
  }

  const indexes = new Set<number>();
  for (let offset = 1; offset <= lookahead; offset += 1) {
    const index = activeIndex + offset;
    if (index < totalItems) {
      indexes.add(index);
    }
  }

  return indexes;
}

export function shouldPrefetchReels(activeIndex: number, totalItems: number, remainingThreshold = 3): boolean {
  if (activeIndex < 0 || totalItems <= 0) {
    return false;
  }

  return activeIndex >= totalItems - remainingThreshold;
}
