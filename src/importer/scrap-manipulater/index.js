import leumi from './leumi.js';

const map = {
  leumi,
};

export default function manipulateScrapResult(enrichedResult) {
  return map[enrichedResult.accountDetails.type]
    ? map[enrichedResult.accountDetails.type](enrichedResult)
    : enrichedResult;
}
