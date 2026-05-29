/**
 * Converts Prisma Decimal objects to plain numbers/strings for safe transmission
 * from Server Actions to Client Components in Next.js.
 *
 * Prisma returns Decimal (decimal.js) for Decimal fields — these are class instances
 * that cannot be serialized by React. JSON.parse(JSON.stringify()) calls Decimal.toJSON()
 * which converts them to strings, eliminating the "Only plain objects" warning.
 */
export function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
