import type { EnrichedAccount } from '../../types.js';

export default function manipulate(enrichedResult: EnrichedAccount): EnrichedAccount | null {
  const accountNumberSplits = enrichedResult.accountNumber.split('_');
  if (accountNumberSplits.length === 2 && !/^[0-9]{2}$/.test(accountNumberSplits[1])) {
    return null;
  }
  return enrichedResult;
}
