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

  // Three type sizes, so heading inference has a real hierarchy to recover:
  // 24pt document title, 16pt section headings, 10pt body.
  const drawPage = (options: { title?: string; heading: string; subject: string }) => {
    const page = pdf.addPage([612, 792]); // US Letter
    let y = 740;

    if (options.title) {
      page.drawText(options.title, { x: 72, y, size: 24, font });
      y -= 40;
    }

    page.drawText(options.heading, { x: 72, y, size: 16, font });
    y -= 30;

    bodyLines(options.subject).forEach((line) => {
      page.drawText(line, { x: 72, y, size: 10, font });
      y -= 22;
    });
  };

  drawPage({ title: 'Residential Lease', heading: 'Section 8 Pets', subject: 'animal' });
  drawPage({ heading: 'Section 9 Noise', subject: 'quiet hours' });

  await writeFile(new URL('two-page-text.pdf', FIXTURE_DIRECTORY), await pdf.save());
}

/** A page with graphics but no text layer at all — what a scan looks like. */
async function writeNoTextLayerPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 500, width: 468, height: 200, color: rgb(0.8, 0.8, 0.8) });

  await writeFile(new URL('no-text-layer.pdf', FIXTURE_DIRECTORY), await pdf.save());
}

/**
 * A lease whose sections carry genuinely different content, so an evaluation
 * question has one right answer rather than seven interchangeable ones. The
 * repetitive fixture is still useful for chunking mechanics; it is useless for
 * measuring retrieval, because every chunk answers every question equally.
 */
async function writeDetailedLeasePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const sections: [string, string[]][] = [
    ['Section 8 - Pets', [
      'No animal may be kept at the property without the prior written consent',
      'of the landlord. This restriction does not apply to a registered',
      'assistance dog, which the tenant may keep without seeking consent.',
    ]],
    ['Section 9 - Noise', [
      'Quiet hours run from 10pm until 7am on every day of the week. During',
      'quiet hours the tenant shall not play amplified music or operate',
      'power tools anywhere at the property.',
    ]],
    ['Section 12 - Deposit', [
      'The deposit of 2,400 pounds is held in a government approved scheme.',
      'It shall be returned within 10 working days of the end of the term,',
      'less any deductions properly made under clause 9.',
    ]],
    ['Schedule 3 - Services', [
      'The landlord shall maintain the mechanical ventilation so that indoor',
      'PM2.5 remains below 15 micrograms per cubic metre at all times, and',
      'shall replace filters every six months.',
    ]],
  ];

  let page = pdf.addPage([612, 792]);
  page.drawText('Residential Lease Agreement', { x: 72, y: 730, size: 24, font: bold });
  let y = 680;

  for (const [heading, lines] of sections) {
    if (y < 200) { page = pdf.addPage([612, 792]); y = 730; }
    page.drawText(heading, { x: 72, y, size: 16, font: bold });
    y -= 28;
    for (const line of lines) {
      page.drawText(line, { x: 72, y, size: 11, font });
      y -= 20;
    }
    y -= 26;
  }

  await writeFile(new URL('lease-detailed.pdf', FIXTURE_DIRECTORY), await pdf.save());
}

await writeTwoPageTextPdf();
await writeNoTextLayerPdf();
await writeDetailedLeasePdf();
console.log('fixtures written');
