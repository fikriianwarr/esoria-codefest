/** Compare a published Firebase Hosting HTML response with the release source. */
export function sameHtmlRelease(actual, expected) {
  // Allow only insignificant transport differences. Content differences mean
  // this is NOT the same HTML release and must fail the smoke test.
  const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return typeof actual === 'string' && typeof expected === 'string' &&
    normalize(actual) === normalize(expected);
}
