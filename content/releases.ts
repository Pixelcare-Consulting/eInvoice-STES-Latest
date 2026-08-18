export type ReleaseNoteType = 'feature' | 'improvement' | 'fix';

export interface ReleaseNoteItem {
  type: ReleaseNoteType;
  items: string[];
}

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  notes: ReleaseNoteItem[];
}

/**
 * End-user release notes.
 * Order within each release: feature → improvement → fix.
 * Same-day updates are consolidated into a single version entry.
 */
export const releases: ReleaseNote[] = [
  {
    version: '1.2.0',
    date: '2026-08-18',
    title: 'LHDN MyInvois SDK 1.0 compliance',
    notes: [
      {
        type: 'feature',
        items: [
          'Stronger checks for invoice amounts, passport IDs, and field length limits before submission',
          'Foreign-currency invoices now require a valid exchange rate to Malaysian Ringgit',
        ],
      },
      {
        type: 'improvement',
        items: [
          'Buyer and delivery party IDs now support BRN, NRIC, passport, and army identification types',
          'Clearer validation messages when addresses, postcodes, state codes, or dates are incomplete or invalid',
          'When LHDN rejects an invoice, you now see what is wrong, why it matters, and which field to fix before resubmitting',
        ],
      },
      {
        type: 'fix',
        items: [
          'Tax-exempt lines can now include the exempted tax amount with a reason, matching current LHDN guidance',
          'Stopped filling missing address and date fields with placeholder “NA” values that caused rejections',
        ],
      },
    ],
  },
];
