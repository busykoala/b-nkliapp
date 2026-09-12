export function canonicalBenchShareUrl(currentUrl: string, benchId: string) {
  const url = new URL("/", currentUrl);
  url.searchParams.set("bank", benchId);
  return url.toString();
}
