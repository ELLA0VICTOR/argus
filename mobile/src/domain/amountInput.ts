/** Format the whole part as you type without rounding or changing decimal precision. */
export function formatTypedAmount(input: string): string {
  const value = input.trim();
  // Leave invalid input visible so validation can reject it; never turn -1 or 1e3 into another amount.
  if (!/^[\d,]*(?:\.\d*)?$/.test(value)) return input;
  const [whole, fraction] = value.split('.');
  const digits = whole.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped || '0'}.${fraction}`;
}
