'use client';

import React from 'react';
import AsyncSelect, { AsyncSelectProps } from './AsyncSelect';
import {
  getVerticalOptions,
  getLocationOptions,
  getCustomerOptions,
  getCarrierOptions,
  getVehicleTypeOptions,
  getVehicleOptions,
  getDriverOptions,
  getDirectionOptions,
} from '@/lib/actions/references';
import { getCustomerContractOptions, getCarrierContractOptions } from '@/lib/actions/contracts';

type BaseProps = Omit<AsyncSelectProps, 'fetchOptions'>;

// cacheKey обязателен: он и подписи предзаполненных значений подтягивает,
// и не даёт каждому экземпляру селекта грузить список заново.
// Ключ должен включать параметры запроса, иначе разные выборки склеятся.

export function VerticalSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Вертикаль" cacheKey="verticals" fetchOptions={() => getVerticalOptions()} {...props} />;
}

export function LocationSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Локация" cacheKey="locations" fetchOptions={() => getLocationOptions()} {...props} />;
}

export function CustomerSelect({ partyRole, ...props }: BaseProps & { partyRole?: 'SHIPPER' | 'CONSIGNEE' }) {
  return (
    <AsyncSelect
      placeholder="Контрагент"
      cacheKey={`customers:${partyRole ?? 'all'}`}
      fetchOptions={() => getCustomerOptions(partyRole)}
      {...props}
    />
  );
}

export function CarrierSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Перевозчик" cacheKey="carriers" fetchOptions={() => getCarrierOptions()} {...props} />;
}

export function VehicleTypeSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Тип ТС" cacheKey="vehicleTypes" fetchOptions={() => getVehicleTypeOptions()} {...props} />;
}

export function VehicleSelect(props: BaseProps) {
  return <AsyncSelect placeholder="ТС" cacheKey="vehicles" fetchOptions={() => getVehicleOptions()} {...props} />;
}

export function DriverSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Водитель" cacheKey="drivers" fetchOptions={() => getDriverOptions()} {...props} />;
}

export function DirectionSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Направление" cacheKey="directions" fetchOptions={() => getDirectionOptions()} {...props} />;
}

export function CustomerContractSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Договор с клиентом" cacheKey="customerContracts" fetchOptions={() => getCustomerContractOptions()} {...props} />;
}

export function CarrierContractSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Договор с перевозчиком" cacheKey="carrierContracts" fetchOptions={() => getCarrierContractOptions()} {...props} />;
}
