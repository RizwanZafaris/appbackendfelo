import { parseVisionResponse } from './google-vision.adapter';

describe('parseVisionResponse', () => {
  it('extracts merchant, total, currency, line items', () => {
    const fixture = {
      responses: [
        {
          fullTextAnnotation: {
            text:
              'Demo Super Market\n123 Main St\nMilk 2L 5.49\nBread 3.99\nEggs (12) 5.99\nSubtotal 15.47\nTax 0.96\nTotal CAD 16.43\n',
            pages: [{ confidence: 0.92 }],
          },
        },
      ],
    };
    const out = parseVisionResponse(fixture);
    expect(out.merchant).toBe('Demo Super Market');
    expect(out.totalMinor).toBe(1643);
    expect(out.currency).toBe('CAD');
    expect(out.confidence).toBeCloseTo(0.92, 2);
    expect(out.lineItems.length).toBeGreaterThanOrEqual(3);
    expect(out.lineItems.find((i) => i.name.includes('Milk'))).toBeDefined();
  });

  it('returns nulls when fields cannot be extracted', () => {
    const out = parseVisionResponse({ responses: [{ fullTextAnnotation: { text: '' } }] });
    expect(out.merchant).toBeNull();
    expect(out.totalMinor).toBeNull();
    expect(out.currency).toBeNull();
    expect(out.lineItems).toEqual([]);
  });

  it('drops summary rows from line items', () => {
    const out = parseVisionResponse({
      responses: [
        {
          fullTextAnnotation: {
            text: 'Coffee 4.50\nSubtotal 4.50\nTax 0.36\nTotal 4.86\n',
          },
        },
      ],
    });
    const names = out.lineItems.map((i) => i.name.toLowerCase());
    expect(names).toContain('coffee');
    expect(names).not.toContain('subtotal');
    expect(names).not.toContain('total');
    expect(names).not.toContain('tax');
  });
});
