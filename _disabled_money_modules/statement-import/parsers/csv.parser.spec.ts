import { CsvStatementParser } from './csv.parser';

describe('CsvStatementParser', () => {
  const p = new CsvStatementParser();

  it('parses a header-mapped statement with positive credit / negative debit amounts', async () => {
    const csv = [
      'Date,Description,Amount',
      '2026-04-01,Pay roll,5000.00',
      '2026-04-02,Coffee shop,-4.50',
      '2026-04-03,Grocery store,-87.34',
    ].join('\n');
    const out = await p.parse(csv, 'CAD');
    expect(out.errors).toEqual([]);
    expect(out.rows.length).toBe(3);
    expect(out.rows[0]).toMatchObject({ direction: 'credit', amountMinor: 500000 });
    expect(out.rows[1]).toMatchObject({ direction: 'debit', amountMinor: 450 });
    expect(out.rows[2]).toMatchObject({ direction: 'debit', amountMinor: 8734 });
  });

  it('parses split debit/credit columns', async () => {
    const csv = [
      'Posted Date,Description,Debit,Credit',
      '01/04/2026,ATM Withdrawal,200.00,',
      '02/04/2026,Salary,,5000.00',
    ].join('\n');
    const out = await p.parse(csv, 'PKR');
    expect(out.rows.length).toBe(2);
    expect(out.rows[0].direction).toBe('debit');
    expect(out.rows[0].amountMinor).toBe(20000);
    expect(out.rows[1].direction).toBe('credit');
    expect(out.rows[1].amountMinor).toBe(500000);
  });

  it('reports per-row errors and continues parsing valid rows', async () => {
    const csv = [
      'Date,Description,Amount',
      'NOT-A-DATE,Bad row,10.00',
      '2026-04-01,Good row,12.34',
    ].join('\n');
    const out = await p.parse(csv, 'USD');
    expect(out.rows.length).toBe(1);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].row).toBe(2);
    expect(out.errors[0].reason).toMatch(/date/i);
  });

  it('produces stable dedupe hashes', async () => {
    const csv = 'Date,Description,Amount\n2026-04-01,Coffee shop,-4.50\n';
    const a = await p.parse(csv, 'CAD');
    const b = await p.parse(csv, 'CAD');
    expect(a.rows[0].hash).toBe(b.rows[0].hash);
  });

  it('handles European decimals (1.234,56)', async () => {
    const csv = 'Date,Description,Amount\n2026-04-01,Restaurant,"-1.234,56"\n';
    const out = await p.parse(csv, 'EUR');
    expect(out.rows[0].amountMinor).toBe(123456);
  });
});
