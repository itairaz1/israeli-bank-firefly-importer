export default function manipulate(enrichedResult) {
  const accountNumberSplits = enrichedResult.accountNumber.split('_');
  if (accountNumberSplits.length === 2 && accountNumberSplits[1].length === 2) {
    return {
      ...enrichedResult,
      accountNumber: accountNumberSplits[0],
    };
  }
  return enrichedResult;
}
