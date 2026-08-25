/**
 * Generates the PDF fixtures used by pdf-extraction.test.ts.
 *
 * Run once; the output is committed. Tests read the committed binaries rather
 * than generating them, so a change in pdf-lib can never quietly change what
 * the extractor is tested against.
 *
 *   npx tsx scripts/generate-pdf-fixtures.mts
 */
import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const FIXTURE_DIRECTORY = new URL('../src/rag/ingest/__fixtures__/', import.meta.url);

async function writeTwoPageTextPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // Realistic body length matters: a page carrying two lines is genuinely
  // ambiguous between sparse-but-real and a scan with a caption, so a fixture
  // that sparse tests the ambiguous case rather than the ordinary one.
  const bodyLines = (subject: string) =>
    Array.from(
      { length: 14 },
      (_, index) =>
        `${index + 1}. The tenant shall observe the ${subject} covenants set out in this ` +
        'agreement and shall not permit any breach thereof.',
    );

  const drawPage = (heading: string, subject: string) => {
    const page = pdf.addPage([612, 792]); // US Letter
    page.drawText(heading, { x: 72, y: 720, size: 18, font });
    bodyLines(subject).forEach((line, index) => {
      page.drawText(line, { x: 72, y: 680 - index * 22, size: 10, font });
    });
  };

  drawPage('Section 8 Pets', 'animal');
  drawPage('Section 9 Noise', 'quiet hours');

  await writeFile(new URL('two-page-text.pdf', FIXTURE_DIRECTORY), await pdf.save());
}

/** A page with graphics but no text layer at all — what a scan looks like. */
async function writeNoTextLayerPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 500, width: 468, height: 200, color: rgb(0.8, 0.8, 0.8) });

  await writeFile(new URL('no-text-layer.pdf', FIXTURE_DIRECTORY), await pdf.save());
}

await writeTwoPageTextPdf();
await writeNoTextLayerPdf();
console.log('fixtures written');
