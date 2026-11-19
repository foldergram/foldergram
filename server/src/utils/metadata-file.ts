import fs from 'node:fs/promises';
import path from 'node:path';

export interface CompanionMetadata {
  title: string | null;
  description: string | null;
  caption: string | null;
  takenAt: number | null;
}

const MAX_METADATA_FILE_SIZE = 64 * 1024; // 64 KB limit for safety
const SUPPORTED_METADATA_EXTENSIONS = ['.txt', '.nfo'] as const;

export function isSupportedMetadataExtension(extension: string): boolean {
  return SUPPORTED_METADATA_EXTENSIONS.includes(extension.toLowerCase() as typeof SUPPORTED_METADATA_EXTENSIONS[number]);
}

function parseDateValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    // If timestamp is in seconds (< 10_000_000_000), convert to ms
    const ms = value < 10000000000 ? Math.round(value * 1000) : Math.round(value);
    return ms > 0 && ms < 4102444800000 ? ms : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Check if numeric string timestamp
    if (/^\d+$/.test(trimmed)) {
      const num = Number.parseInt(trimmed, 10);
      return parseDateValue(num);
    }

    // Handle EXIF style formatted timestamps: YYYY:MM:DD HH:MM:SS
    const normalized = trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');

    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 4102444800000) {
      return null;
    }
    return parsed;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 && time < 4102444800000 ? time : null;
  }

  return null;
}

function cleanXmlText(text: string): string {
  let cleaned = text.trim();
  const cdataMatch = cleaned.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdataMatch) {
    cleaned = cdataMatch[1].trim();
  }
  return cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'");
}

function combineCaption(title: string | null, description: string | null): string | null {
  const cleanTitle = title?.trim() || null;
  const cleanDesc = description?.trim() || null;

  if (cleanTitle && cleanDesc) {
    if (cleanTitle.toLowerCase() === cleanDesc.toLowerCase()) {
      return cleanTitle;
    }
    if (cleanDesc.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
      return cleanDesc;
    }
    return `${cleanTitle}\n\n${cleanDesc}`;
  }

  return cleanTitle || cleanDesc || null;
}

export function parseMetadataContent(content: string): CompanionMetadata {
  const trimmed = content.trim();
  if (!trimmed) {
    return { title: null, description: null, caption: null, takenAt: null };
  }

  // 1. Try JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const json = JSON.parse(trimmed);
      if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
        const title = typeof json.title === 'string' ? json.title.trim() || null : null;
        const descCandidate = typeof json.description === 'string' ? json.description
          : typeof json.caption === 'string' ? json.caption
          : typeof json.comment === 'string' ? json.comment : null;
        const description = descCandidate?.trim() || null;
        const dateCandidate = json.date ?? json.taken_at ?? json.takenAt ?? json.post_date ?? json.timestamp;
        const takenAt = parseDateValue(dateCandidate);

        return {
          title,
          description,
          caption: combineCaption(title, description),
          takenAt
        };
      }
    } catch {
      // Fall through if invalid JSON
    }
  }

  // 2. Try XML / NFO format
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const titleMatch = trimmed.match(/<(?:title|name|headline)[^>]*>([\s\S]*?)<\/(?:title|name|headline)>/i);
    const descMatch = trimmed.match(/<(?:description|plot|outline|summary|caption|comment|review)[^>]*>([\s\S]*?)<\/(?:description|plot|outline|summary|caption|comment|review)>/i);
    const dateMatch = trimmed.match(/<(?:date|aired|premiered|dateadded|released|postdate|timestamp)[^>]*>([\s\S]*?)<\/(?:date|aired|premiered|dateadded|released|postdate|timestamp)>/i);

    if (titleMatch || descMatch || dateMatch) {
      const title = titleMatch ? cleanXmlText(titleMatch[1]) || null : null;
      const description = descMatch ? cleanXmlText(descMatch[1]) || null : null;
      const takenAt = dateMatch ? parseDateValue(cleanXmlText(dateMatch[1])) : null;

      return {
        title,
        description,
        caption: combineCaption(title, description),
        takenAt
      };
    }
  }

  // 3. Try Key-Value / Headers format
  const lines = content.split(/\r?\n/);
  const headerRegex = /^(title|headline|caption|description|plot|summary|outline|date|release[\s_-]?date|air[\s_-]?date|taken[\s_-]?at|post[\s_-]?date|timestamp)\s*[:=]\s*(.*)$/i;
  let hasHeaders = false;
  let parsedTitle: string | null = null;
  let parsedDesc: string | null = null;
  let parsedDate: string | null = null;
  const remainingLines: string[] = [];
  let inBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBody) {
      remainingLines.push(line);
      continue;
    }

    const match = line.match(headerRegex);
    if (match) {
      hasHeaders = true;
      const key = match[1].toLowerCase().replace(/[\s_-]/g, '');
      const val = match[2].trim();
      if (key === 'title' || key === 'headline') {
        parsedTitle = val;
      } else if (key === 'description' || key === 'caption' || key === 'plot' || key === 'summary' || key === 'outline') {
        parsedDesc = val;
      } else if (key === 'date' || key === 'releasedate' || key === 'airdate' || key === 'takenat' || key === 'postdate' || key === 'timestamp') {
        parsedDate = val;
      }
    } else if (hasHeaders && line.trim() === '') {
      inBody = true;
    } else if (hasHeaders) {
      inBody = true;
      remainingLines.push(line);
    }
  }

  if (hasHeaders) {
    const bodyText = remainingLines.join('\n').trim();
    let finalDesc = parsedDesc;
    if (bodyText) {
      finalDesc = finalDesc ? `${finalDesc}\n\n${bodyText}` : bodyText;
    }

    return {
      title: parsedTitle || null,
      description: finalDesc || null,
      caption: combineCaption(parsedTitle, finalDesc),
      takenAt: parseDateValue(parsedDate)
    };
  }

  // 4. Plain text fallback: entire content is caption
  return {
    title: null,
    description: trimmed,
    caption: trimmed,
    takenAt: null
  };
}

export async function readCompanionMetadata(filePath?: string): Promise<CompanionMetadata | null> {
  if (!filePath) return null;

  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_METADATA_FILE_SIZE) {
      // Exceeds safety threshold for metadata text file
      return null;
    }

    const content = await fs.readFile(filePath, { encoding: 'utf-8' });
    return parseMetadataContent(content);
  } catch {
    return null;
  }
}
