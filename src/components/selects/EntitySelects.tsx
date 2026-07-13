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

export function VerticalSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Вертикаль" fetchOptions={() => getVerticalOptions()} {...props} />;
}

export function LocationSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Локация" fetchOptions={() => getLocationOptions()} {...props} />;
}

export function CustomerSelect({ partyRole, ...props }: BaseProps & { partyRole?: 'SHIPPER' | 'CONSIGNEE' }) {
  return <AsyncSelect placeholder="Контрагент" fetchOptions={() => getCustomerOptions(partyRole)} {...props} />;
}

export function CarrierSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Перевозчик" fetchOptions={() => getCarrierOptions()} {...props} />;
}

export function VehicleTypeSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Тип ТС" fetchOptions={() => getVehicleTypeOptions()} {...props} />;
}

export function VehicleSelect(props: BaseProps) {
  return <AsyncSelect placeholder="ТС" fetchOptions={() => getVehicleOptions()} {...props} />;
}

export function DriverSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Водитель" fetchOptions={() => getDriverOptions()} {...props} />;
}

export function DirectionSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Направление" fetchOptions={() => getDirectionOptions()} {...props} />;
}

export function CustomerContractSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Договор с клиентом" fetchOptions={() => getCustomerContractOptions()} {...props} />;
}

export function CarrierContractSelect(props: BaseProps) {
  return <AsyncSelect placeholder="Договор с перевозчиком" fetchOptions={() => getCarrierContractOptions()} {...props} />;
}
