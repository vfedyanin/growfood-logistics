// Реестр парсеров PDF по ключу контрагента (Customer.parserKey).
import type { ParserFn } from '../types';
import { parseKorolevskyVkus } from './korolevskyVkus';
import { parseFermerskySupermarket } from './fermerskySupermarket';

export const PARSERS: Record<string, ParserFn> = {
  'korolevsky-vkus': parseKorolevskyVkus,
  'fermersky-supermarket': parseFermerskySupermarket,
};

export function getParser(parserKey: string | null | undefined): ParserFn | null {
  if (!parserKey) return null;
  return PARSERS[parserKey] ?? null;
}
