export default function manipulate(enrichedResult) {
  const accountNumberSplits = enrichedResult.accountNumber.split('_');
  if (accountNumberSplits.length === 2 && accountNumberSplits[1] !== '01') {
    return null;
  }
  return enrichedResult;
}
