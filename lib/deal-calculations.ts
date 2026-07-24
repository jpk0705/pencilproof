export const paymentFor = (principal: number, apr: number, months: number) => {
  if (principal <= 0 || months <= 0) return 0;
  const rate = apr / 1200;
  if (rate === 0) return principal / months;
  return (principal * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
};
