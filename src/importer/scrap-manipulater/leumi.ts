export default function manipulate(enrichedResult: any) {
  const accountNumberSplits = enrichedResult.accountNumber.split('_');
  if (accountNumberSplits.length === 2 && !/^[0-9]{2}$/.test(accountNumberSplits[1])) {
    return null;
  }
  return enrichedResult;
}
