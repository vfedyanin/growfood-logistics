// Подбор машин под объём — чистая логика, без базы, поэтому проверяется на
// примерах напрямую.
//
// Правило, согласованное с заказчиком:
//   берём самую маленькую машину, в которую влезает весь объём;
//   если не влезает ни в одну — отгружаем полную самую большую и применяем то
//   же правило к остатку.
//
// Список машин — ТОЛЬКО те типы, на которые у перевозчика есть тариф на это
// направление. Если у перевозчика в тарифах одни восьмипаллетки, фуры взяться
// неоткуда, и объём 24 поедет тремя восьмёрками.

// Проверено на согласованных примерах (парк 4/8/10/12/15/16/18/20/33):
//   плечи 33+12   → VT-33(33) + VT-12(12)
//   плечи 33+24   → VT-33(33) + VT-33(24)   между 20 и 33 типов нет
//   плечи 33+33+21 → три фуры, в последней 21
//   плечи 33+3    → VT-33(33) + VT-4(3)
//   плечо 12      → VT-12(12)
//   плечи 20+20+5 → VT-33(25) + VT-20(20)   20 и 20 в фуру не влезают
//   только VT-8, плечо 20 → VT-8(20, перебор)  плечо не дробится
//   OVERLOAD 20+20 → VT-33(40, перебор)

export type VehicleOption = { code: string; capacity: number };
export type PackItem = { legId: string; pallets: number };
export type PackedTruck = {
  vehicleTypeCode: string;
  capacity: number;
  pallets: number;
  overload: boolean;
  legIds: string[];
};

/** Самая маленькая машина, в которую влезает груз; если ни одна не влезает — самая большая. */
export function pickVehicle(load: number, vehicles: VehicleOption[]): VehicleOption {
  const asc = [...vehicles].sort((a, b) => a.capacity - b.capacity);
  return asc.find((v) => v.capacity >= load) ?? asc[asc.length - 1];
}

/**
 * Раскладка плеч по машинам.
 *
 * ВАЖНО: правило заказчика сформулировано про объём, а грузим мы неделимыми
 * плечами — плечо между машинами не дробится (решение от 10.08). Поэтому размер
 * машины выбирается ПОСЛЕ раскладки, по фактической загрузке, а не заранее по
 * арифметике. Иначе на плечах 20 + 20 + 5 правило дало бы «33 + 12», а 20 в
 * двенадцатипаллетник не влезает.
 */
export function packLegs(
  items: PackItem[],
  vehicles: VehicleOption[],
  mode: 'OVERLOAD' | 'SPLIT',
): PackedTruck[] {
  if (!items.length || !vehicles.length) return [];
  const asc = [...vehicles].sort((a, b) => a.capacity - b.capacity);
  const maxCap = asc[asc.length - 1].capacity;

  if (mode === 'OVERLOAD') {
    // Всё в одну машину, даже с перебором: так возят на Пятёрочку НН.
    //
    // Машина при этом подбирается ПОД ГРУЗ, а не «самая большая, какая есть».
    // Смысл флага — не дробить на несколько машин, а не переплачивать за размер:
    // три паллеты на Волгоград в VT-18 стоили 100 000 вместо 76 190 за VT-8.
    // Перебор от этого не исчезает — он там, где груз реально не влезает:
    // 13 паллет при парке из одних VT-10, 21 паллета при максимуме VT-20.
    const pallets = items.reduce((s, i) => s + i.pallets, 0);
    const v = pickVehicle(pallets, asc);
    return [{
      vehicleTypeCode: v.code,
      capacity: v.capacity,
      pallets,
      overload: pallets > v.capacity,
      legIds: items.map((i) => i.legId),
    }];
  }

  // Раскладываем по корзинам ёмкостью самой большой машины, крупные плечи
  // вперёд: так меньше машин, чем при укладке в порядке поступления.
  const bins: PackItem[][] = [];
  const loads: number[] = [];
  for (const item of [...items].sort((a, b) => b.pallets - a.pallets)) {
    // Плечо больше самой большой машины не делится — поедет с перебором одно.
    if (item.pallets > maxCap) {
      bins.push([item]);
      loads.push(item.pallets);
      continue;
    }
    // Корзина с перебором сюда не попадёт: у неё загрузка уже больше maxCap.
    let idx = loads.findIndex((l) => l + item.pallets <= maxCap);
    if (idx === -1) { bins.push([]); loads.push(0); idx = bins.length - 1; }
    bins[idx].push(item);
    loads[idx] += item.pallets;
  }

  // Каждой корзине — самая маленькая машина, в которую влезает её фактический груз.
  return bins.map((bin, i) => {
    const v = pickVehicle(loads[i], asc);
    return {
      vehicleTypeCode: v.code,
      capacity: v.capacity,
      pallets: loads[i],
      overload: loads[i] > v.capacity,
      legIds: bin.map((x) => x.legId),
    };
  });
}
