// Реестр парсеров PDF по ключу контрагента (Customer.parserKey).
import type { ParserFn } from '../types';
import { parseKorolevskyVkus } from './korolevskyVkus';
import { parseGfTrade } from './gfTrade';

export const PARSERS: Record<string, ParserFn> = {
  'korolevsky-vkus': parseKorolevskyVkus,
  'gf-trade': parseGfTrade,
};

export function getParser(parserKey: string | null | undefined): ParserFn | null {
  if (!parserKey) return null;
  return PARSERS[parserKey] ?? null;
}
