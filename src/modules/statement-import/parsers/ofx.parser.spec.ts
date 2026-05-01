import { OfxStatementParser } from './ofx.parser';

describe('OfxStatementParser', () => {
  const p = new OfxStatementParser();

  it('parses OFX 2.x SGML transactions', async () => {
    const ofx = `<OFX>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260401120000
<TRNAMT>-12.34
<NAME>COFFEE SHOP
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260402093000
<TRNAMT>5000.00
<NAME>SALARY
</STMTTRN>
</BANKTRANLIST>
</OFX>`;
    const out = await p.parse(ofx, 'CAD');
    expect(out.errors).toEqual([]);
    expect(out.rows.length).toBe(2);
    expect(out.rows[0].direction).toBe('debit');
    expect(out.rows[0].amountMinor).toBe(1234);
    expect(out.rows[0].merchant).toBe('COFFEE SHOP');
    expect(out.rows[1].direction).toBe('credit');
    expect(out.rows[1].amountMinor).toBe(500000);
  });

  it('records errors for malformed transactions but keeps valid ones', async () => {
    const ofx = `<STMTTRN>
<DTPOSTED>BADDATE
<TRNAMT>10
</STMTTRN>
<STMTTRN>
<DTPOSTED>20260401
<TRNAMT>50
<NAME>Valid
</STMTTRN>`;
    const out = await p.parse(ofx, 'USD');
    expect(out.rows.length).toBe(1);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].reason).toMatch(/date/i);
  });
});
