import leumi from './leumi.js';

const map: Record<string, (x: any) => any> = {
  leumi,
};

export default function manipulateScrapResult(enrichedResult: any) {
  return map[enrichedResult.accountDetails.type]
    ? map[enrichedResult.accountDetails.type](enrichedResult)
    : enrichedResult;
}
