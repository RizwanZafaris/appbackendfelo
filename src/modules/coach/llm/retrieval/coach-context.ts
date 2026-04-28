/**
 * Compressed user context shape passed to the LLM. All money values are
 * minor units (paise/cents) to match the rest of the FELO backend; the
 * compressor renders them as whole-unit strings for the prompt.
 */
export interface CoachContext {
  userId: string;
  tier: 'free' | 'plus' | 'plus_plus' | 'family';
  corridor: 'PK' | 'CA' | 'CA_PK';
  currency: 'PKR' | 'CAD';
  monthlyIncomeMinor: number;
  monthlySpendMinor: number;
  savingsMinor: number;
  recentTransactions: Array<{
    date: string;
    category: string | null;
    merchant: string | null;
    amountMinor: number;
  }>;
  goals: Array<{ name: string; targetMinor: number; currentMinor: number; deadline?: string }>;
  bills: Array<{ name: string; amountMinor: number; dueDay: number; paidThisMonth: boolean }>;
}

/** Render context as a compact string (<500 tokens) for the LLM prompt. */
export function compressContext(ctx: CoachContext): string {
  const c = ctx.currency;
  const lines = [
    `PROFILE: tier=${ctx.tier} corridor=${ctx.corridor} currency=${c} ` +
      `income=${Math.trunc(ctx.monthlyIncomeMinor / 100)} ` +
      `spend=${Math.trunc(ctx.monthlySpendMinor / 100)} ` +
      `savings=${Math.trunc(ctx.savingsMinor / 100)} (per-month)`,
  ];
  if (ctx.recentTransactions.length) {
    lines.push('TRANSACTIONS (recent):');
    for (const t of ctx.recentTransactions.slice(0, 10)) {
      const merchant = t.merchant ? ` ${t.merchant}` : '';
      lines.push(
        `- ${t.date} ${t.category ?? 'uncategorised'}${merchant} ${Math.trunc(t.amountMinor / 100)}`,
      );
    }
  }
  if (ctx.goals.length) {
    lines.push('GOALS:');
    for (const g of ctx.goals) {
      const dl = g.deadline ? ` by ${g.deadline}` : '';
      lines.push(
        `- ${g.name}: ${Math.trunc(g.currentMinor / 100)}/${Math.trunc(g.targetMinor / 100)}${dl}`,
      );
    }
  }
  if (ctx.bills.length) {
    lines.push('BILLS:');
    for (const b of ctx.bills) {
      lines.push(
        `- ${b.name} ${Math.trunc(b.amountMinor / 100)} day-${b.dueDay} ${b.paidThisMonth ? 'paid' : 'due'}`,
      );
    }
  }
  return lines.join('\n');
}

export interface CoachSource {
  type: 'profile' | 'transactions' | 'goals' | 'bills';
  label: string;
  value: string;
}

export function contextSources(ctx: CoachContext): CoachSource[] {
  const c = ctx.currency;
  const out: CoachSource[] = [
    {
      type: 'profile',
      label: 'monthly income',
      value: `${c} ${Math.trunc(ctx.monthlyIncomeMinor / 100)}`,
    },
    {
      type: 'profile',
      label: 'monthly spend',
      value: `${c} ${Math.trunc(ctx.monthlySpendMinor / 100)}`,
    },
    { type: 'profile', label: 'savings', value: `${c} ${Math.trunc(ctx.savingsMinor / 100)}` },
  ];
  if (ctx.goals.length)
    out.push({ type: 'goals', label: 'active goals', value: String(ctx.goals.length) });
  if (ctx.bills.length)
    out.push({ type: 'bills', label: 'tracked bills', value: String(ctx.bills.length) });
  return out;
}
