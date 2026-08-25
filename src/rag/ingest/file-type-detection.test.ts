import { describe, expect, it } from 'vitest';
import { detectFileType } from './file-type-detection';

const bytesOf = (text: string) => new TextEncoder().encode(text);

/** A zip local file header, followed by the first entry's path. */
const zipContaining = (firstEntryPath: string) => {
  const header = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
  const path = bytesOf(firstEntryPath);
  const combined = new Uint8Array(header.length + path.length);
  combined.set(header);
  combined.set(path, header.length);
  return combined;
};

describe('formats we can read', () => {
  it('recognizes a PDF by its signature', () => {
    expect(detectFileType(bytesOf('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'))).toBe('pdf');
  });

  it('recognizes a Word document by the word/ entry inside its zip', () => {
    expect(detectFileType(zipContaining('word/document.xml'))).toBe('docx');
  });

  it('recognizes plain prose as text', () => {
    expect(detectFileType(bytesOf('Section 8 — Pets\n\nNo animals may be kept.'))).toBe('text');
  });

  it('recognizes Markdown as text', () => {
    expect(detectFileType(bytesOf('# Lease\n\n- one\n- two\n'))).toBe('text');
  });
});

describe('formats we cannot read', () => {
  it('refuses a spreadsheet, which is a zip but not a Word document', () => {
    expect(detectFileType(zipContaining('xl/workbook.xml'))).toBe('unsupported');
  });

  it('refuses arbitrary binary', () => {
    expect(detectFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'unsupported',
    );
  });

  it('refuses an empty file', () => {
    expect(detectFileType(new Uint8Array())).toBe('unsupported');
  });
});

describe('the reason this module exists', () => {
  it('reads the bytes, so a zip renamed to .pdf is still a zip', () => {
    // A caller controls the filename and the declared MIME type. Neither is
    // evidence. Only the bytes are.
    const zipPretendingToBeAPdf = zipContaining('xl/workbook.xml');

    expect(detectFileType(zipPretendingToBeAPdf)).toBe('unsupported');
    expect(detectFileType(zipPretendingToBeAPdf)).not.toBe('pdf');
  });

  it('does not accept a PDF signature that appears later in the file', () => {
    // The signature identifies a PDF only at offset zero. Finding it anywhere
    // would let any file smuggle one in.
    expect(detectFileType(bytesOf('harmless prefix %PDF-1.7'))).toBe('text');
  });
});
