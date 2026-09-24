export const CREDIT_PACKAGES = Object.freeze([
  Object.freeze({ credits: 100, priceUSD: "5.00" }),
  Object.freeze({ credits: 500, priceUSD: "20.00" }),
  Object.freeze({ credits: 1000, priceUSD: "30.00" }),
]);

export function getCreditPackage(credits) {
  return CREDIT_PACKAGES.find((pkg) => pkg.credits === credits) ?? null;
}
