/**
 * Generates the evaluation corpus: four unrelated documents a household might
 * actually hold.
 *
 * The point is not volume. It is that several documents use the same words for
 * different things — "notice period" ends a tenancy in one and a job in
 * another; "excess" and "deposit" are both sums you might get back; flood
 * appears in two. A corpus of one document cannot test whether retrieval picks
 * the right source, because there is only one source to pick.
 *
 *   npx tsx scripts/generate-corpus-fixtures.mts
 */
import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const DIRECTORY = new URL('../src/rag/eval/__corpus__/', import.meta.url);

type Section = [heading: string, lines: string[]];

async function writeDocument(filename: string, title: string, sections: Section[]) {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([612, 792]);
  page.drawText(title, { x: 64, y: 730, size: 22, font: bold, color: rgb(0.07, 0.09, 0.12) });
  let y = 686;

  for (const [heading, lines] of sections) {
    if (y < 160) {
      page = pdf.addPage([612, 792]);
      y = 730;
    }
    page.drawText(heading, { x: 64, y, size: 15, font: bold });
    y -= 26;
    for (const line of lines) {
      page.drawText(line, { x: 64, y, size: 10.5, font: body });
      y -= 18;
    }
    y -= 24;
  }

  await writeFile(new URL(filename, DIRECTORY), await pdf.save());
}

await writeDocument('residential-lease.pdf', 'Residential Lease Agreement', [
  ['Section 8 - Pets', [
    'No animal may be kept at the property without the prior written',
    'consent of the landlord. This restriction does not apply to a',
    'registered assistance dog, which the tenant may keep without consent.',
  ]],
  ['Section 9 - Noise', [
    'Quiet hours run from 10pm until 7am on every day of the week.',
    'During quiet hours the tenant shall not play amplified music or',
    'operate power tools anywhere at the property.',
  ]],
  ['Section 12 - Deposit', [
    'The deposit of 2,400 pounds is held in a government approved scheme.',
    'It is returned within 10 working days of the end of the term, less',
    'any deductions properly made under clause 9.',
  ]],
  ['Section 15 - Notice period', [
    'The tenant shall give two months written notice to end the tenancy.',
    'Notice may not expire before the end of the fixed term.',
  ]],
  ['Schedule 3 - Services', [
    'The landlord shall maintain the mechanical ventilation so that indoor',
    'PM2.5 remains below 15 micrograms per cubic metre, and shall replace',
    'filters every six months.',
  ]],
]);

await writeDocument('employee-handbook.pdf', 'Employee Handbook', [
  ['Working from home', [
    'Employees may work remotely up to three days each week. Attendance',
    'in the office is required on Tuesdays for team planning.',
  ]],
  ['Expenses', [
    'Claims must be submitted within 30 days with an itemised receipt.',
    'Rail travel is reimbursed at standard class only. Taxi fares are',
    'reimbursed only for journeys beginning before 7am or after 10pm.',
  ]],
  ['Annual leave', [
    'The allowance is 28 days including public holidays. Up to five days',
    'may be carried into the following year and must be taken by March.',
  ]],
  ['Notice period', [
    'Employees in their first two years give four weeks notice. After two',
    'years the notice period rises to eight weeks on either side.',
  ]],
]);

await writeDocument('home-insurance.pdf', 'Home Insurance Policy', [
  ['Your excess', [
    'The standard excess is 250 pounds for each claim. A separate excess',
    'of 1,000 pounds applies to any claim arising from subsidence.',
  ]],
  ['Flood and escape of water', [
    'Damage caused by flood is covered. Damage caused by a gradual leak',
    'that you knew about and did not repair is not covered.',
  ]],
  ['Making a claim', [
    'Report a claim within 48 hours by telephone. Keep damaged items',
    'until the loss adjuster has inspected them, unless they are unsafe.',
  ]],
  ['What is not covered', [
    'Wear and tear, mechanical breakdown, and any loss occurring while',
    'the property has been unoccupied for more than 60 consecutive days.',
  ]],
]);

await writeDocument('broadband-agreement.pdf', 'Broadband Service Agreement', [
  ['Speeds', [
    'The advertised average download speed is 150 megabits per second,',
    'measured at peak time between 8pm and 10pm.',
  ]],
  ['Outages and compensation', [
    'If the service is not restored within two full working days of a',
    'reported fault, compensation accrues at 8.40 pounds for each day.',
  ]],
  ['Ending the agreement early', [
    'Leaving before the end of the 24 month term incurs a charge equal to',
    'the monthly price for each remaining month, discounted by 10 percent.',
  ]],
  ['Engineer visits', [
    'A missed engineer appointment is charged at 25 pounds unless it is',
    'cancelled more than 24 hours beforehand.',
  ]],
]);

console.log('corpus written');
