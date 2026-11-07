import type { EnrichedAccount } from '../../types.js';
import leumi from './leumi.js';

type Manipulator = (enrichedResult: EnrichedAccount) => EnrichedAccount | null;

const map: Partial<Record<string, Manipulator>> = {
  leumi,
};

export default function manipulateScrapResult(
  enrichedResult: EnrichedAccount,
): EnrichedAccount | null {
  const manipulator = map[enrichedResult.accountDetails.type];
  return manipulator
    ? manipulator(enrichedResult)
    : enrichedResult;
}
