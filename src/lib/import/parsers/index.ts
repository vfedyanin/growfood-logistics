// Реестр парсеров PDF по ключу контрагента (Customer.parserKey).
import type { ParserFn } from '../types';
import { parseKorolevskyVkus } from './korolevskyVkus';
import { parsePolyana } from './polyana';
import { parseFermerskySupermarket } from './fermerskySupermarket';

export const PARSERS: Record<string, ParserFn> = {
  'korolevsky-vkus': parseKorolevskyVkus,
  'polyana': parsePolyana,
  'fermersky-supermarket': parseFermerskySupermarket,
};

export function getParser(parserKey: string | null | undefined): ParserFn | null {
  if (!parserKey) return null;
  return PARSERS[parserKey] ?? null;
}
