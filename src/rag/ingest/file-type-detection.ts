/**
 * Identifies an uploaded file from its own bytes.
 *
 * A caller controls the filename and the declared MIME type, so neither is
 * evidence of anything. Believing them is how a parser gets handed a file it
 * cannot safely read — and how a size or type limit gets bypassed by renaming.
 * Every signature below is matched at the offset where the format actually
 * places it, because a signature found anywhere in a file proves nothing.
 */

export type DetectedFileType = 'pdf' | 'docx' | 'text' | 'unsupported';

/** "%PDF-", which a PDF carries at offset zero. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** "PK\x03\x04" — the local file header every zip archive opens with. */
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/**
 * Office formats are all zips, so the archive signature alone cannot tell a
 * Word document from a spreadsheet. The first entry's path can, and it sits
 * immediately after the local file header — no need to inflate anything.
 */
const OOXML_PATH_SEARCH_LIMIT = 4096;
const WORD_DOCUMENT_ENTRY_PREFIX = 'word/';

/** Control characters that plain text does not contain, less tab/newline/return. */
function looksLikeDecodableText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }

  for (const character of decoded) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const isStructuralWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    if (!isStructuralWhitespace && codePoint < 0x20) return false;
  }

  return true;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

export function detectFileType(bytes: Uint8Array): DetectedFileType {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'pdf';

  if (startsWith(bytes, ZIP_LOCAL_FILE_HEADER_SIGNATURE)) {
    const opening = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, OOXML_PATH_SEARCH_LIMIT),
    );
    return opening.includes(WORD_DOCUMENT_ENTRY_PREFIX) ? 'docx' : 'unsupported';
  }

  return looksLikeDecodableText(bytes) ? 'text' : 'unsupported';
}
