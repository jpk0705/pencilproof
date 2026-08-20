export const paymentFor = (principal: number, apr: number, months: number) => {
  if (principal <= 0 || months <= 0) return 0;
  // A one-payment term is PencilProof's cash-deal representation. Do not
  // apply one month of interest or present a cash total as a monthly payment.
  if (months === 1) return principal;
  const rate = apr / 1200;
  if (rate === 0) return principal / months;
  return (principal * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
};
