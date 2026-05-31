# GrowFood Logistics MVP — Техническое задание

## Обзор

Система учёта магистральной логистики для компании GrowFood. Кроссплатформенное веб-приложение (desktop + mobile) с адаптивным дизайном.

## Технологический стек

- **Frontend**: Next.js 14 (App Router) + React 18 + TypeScript
- **UI**: Ant Design 5 (responsive)
- **Графики**: Recharts
- **База данных**: PostgreSQL (использовать Docker)
- **ORM**: Prisma
- **Аутентификация**: NextAuth.js v5 (Auth.js)
- **Валидация**: Zod
- **PWA**: next-pwa (для установки на мобильные)

## Структура базы данных

### 1. Аутентификация и роли

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  password      String    // bcrypt hash
  name          String
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  roles         UserRole[]
  sessions      Session[]
}

model Role {
  id          String   @id @default(cuid())
  name        String   @unique  // "admin", "logistics_manager", "finance", "viewer"
  description String?
  
  users       UserRole[]
  permissions RolePermission[]
}

model UserRole {
  id      String @id @default(cuid())
  userId  String
  roleId  String
  
  user    User   @relation(fields: [userId], references: [id])
  role    Role   @relation(fields: [roleId], references: [id])
  
  @@unique([userId, roleId])
}

model Permission {
  id          String   @id @default(cuid())
  code        String   @unique  // "dictionaries:read", "trips:write", etc.
  name        String
  category    String   // "dictionaries", "operations", "finance", "analytics", "admin"
  
  roles       RolePermission[]
}

model RolePermission {
  id           String @id @default(cuid())
  roleId       String
  permissionId String
  
  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])
  
  @@unique([roleId, permissionId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 2. Справочники

```prisma
model Vertical {
  id        String   @id @default(cuid())
  code      String   @unique  // "GROWFOOD", "PRIEM", "RETAIL", "VENDING", "LAAS"
  name      String
  type      VerticalType  // INTERNAL, EXTERNAL
  isActive  Boolean  @default(true)
  
  customers Customer[]
  cargoUnits CargoUnit[]
}

enum VerticalType {
  INTERNAL
  EXTERNAL
}

model Customer {
  id           String   @id @default(cuid())
  verticalId   String
  code         String   @unique
  name         String
  customerType CustomerType
  inn          String?
  legalName    String?
  isActive     Boolean  @default(true)
  
  vertical     Vertical @relation(fields: [verticalId], references: [id])
  contracts    CustomerContract[]
  cargoUnits   CargoUnit[]
  acts         CustomerAct[]
  invoices     CustomerInvoice[]
  payments     CustomerPayment[]
}

enum CustomerType {
  INTERNAL
  RETAIL_CHAIN
  EXTERNAL_COMPANY
}

model CustomerContract {
  id             String   @id @default(cuid())
  customerId     String
  contractNumber String
  contractDate   DateTime
  validFrom      DateTime
  validTo        DateTime?
  pricingModel   PricingModel
  isActive       Boolean  @default(true)
  
  customer       Customer @relation(fields: [customerId], references: [id])
  tariffs        ContractTariff[]
}

enum PricingModel {
  PER_PALLET
  PER_KG
  PER_TRIP
  PER_KM
}

model ContractTariff {
  id            String   @id @default(cuid())
  contractId    String
  routeId       String?
  originId      String?
  destinationId String?
  unit          TariffUnit
  price         Decimal  @db.Decimal(12, 2)
  currency      String   @default("RUB")
  validFrom     DateTime
  validTo       DateTime?
  
  contract      CustomerContract @relation(fields: [contractId], references: [id])
  route         Route?   @relation(fields: [routeId], references: [id])
  origin        Location? @relation("TariffOrigin", fields: [originId], references: [id])
  destination   Location? @relation("TariffDestination", fields: [destinationId], references: [id])
}

enum TariffUnit {
  PALLET
  BOX
  KG
  TRIP
  KM
}

model Location {
  id        String   @id @default(cuid())
  code      String   @unique
  name      String
  type      LocationType
  address   String?
  city      String?
  region    String?
  lat       Decimal? @db.Decimal(9, 6)
  lon       Decimal? @db.Decimal(9, 6)
  timezone  String?
  isActive  Boolean  @default(true)
  
  routesAsOrigin      Route[] @relation("RouteOrigin")
  routesAsDestination Route[] @relation("RouteDestination")
  tripsAsOrigin       Trip[]  @relation("TripOrigin")
  tripsAsDestination  Trip[]  @relation("TripDestination")
  supplyChainLegsAsOrigin SupplyChainLeg[] @relation("LegOrigin")
  supplyChainLegsAsDestination SupplyChainLeg[] @relation("LegDestination")
  tariffsAsOrigin     ContractTariff[] @relation("TariffOrigin")
  tariffsAsDestination ContractTariff[] @relation("TariffDestination")
}

enum LocationType {
  WAREHOUSE
  HUB
  KITCHEN
  DC
  RETAIL_POINT
}

model Vehicle {
  id              String   @id @default(cuid())
  plateNumber     String   @unique
  type            VehicleType
  capacityKg      Decimal? @db.Decimal(10, 2)
  capacityM3      Decimal? @db.Decimal(10, 2)
  capacityPallets Int?
  hasRefrigerator Boolean  @default(false)
  tempMin         Decimal? @db.Decimal(4, 1)
  tempMax         Decimal? @db.Decimal(4, 1)
  carrierId       String?
  isActive        Boolean  @default(true)
  
  carrier         Carrier? @relation(fields: [carrierId], references: [id])
  trips           Trip[]
}

enum VehicleType {
  TRUCK
  VAN
  REFRIGERATOR
}

model Carrier {
  id             String   @id @default(cuid())
  code           String   @unique
  name           String
  inn            String?
  contractNumber String?
  contractStart  DateTime?
  contractEnd    DateTime?
  isActive       Boolean  @default(true)
  
  vehicles       Vehicle[]
  trips          Trip[]
  acts           CarrierAct[]
  invoices       CarrierInvoice[]
  payments       CarrierPayment[]
}

model Route {
  id             String   @id @default(cuid())
  code           String   @unique
  originId       String
  destinationId  String
  distanceKm     Decimal? @db.Decimal(10, 2)
  estimatedHours Decimal? @db.Decimal(5, 2)
  routeType      RouteType
  isActive       Boolean  @default(true)
  
  origin         Location @relation("RouteOrigin", fields: [originId], references: [id])
  destination    Location @relation("RouteDestination", fields: [destinationId], references: [id])
  trips          Trip[]
  tariffs        ContractTariff[]
  marketPrices   MarketPrice[]
}

enum RouteType {
  DIRECT
  HUB
  MILK_RUN
}

model MarketPrice {
  id           String   @id @default(cuid())
  routeId      String
  vehicleType  VehicleType
  pricePerTrip Decimal? @db.Decimal(12, 2)
  pricePerKm   Decimal? @db.Decimal(8, 2)
  validFrom    DateTime
  validTo      DateTime?
  source       String?
  
  route        Route    @relation(fields: [routeId], references: [id])
}

model SupplyChainLeg {
  id                  String   @id @default(cuid())
  code                String   @unique
  name                String
  originId            String
  destinationId       String
  legType             LegType
  standardDistanceKm  Decimal? @db.Decimal(10, 2)
  standardTransitHours Decimal? @db.Decimal(5, 2)
  isActive            Boolean  @default(true)
  
  origin              Location @relation("LegOrigin", fields: [originId], references: [id])
  destination         Location @relation("LegDestination", fields: [destinationId], references: [id])
  trips               Trip[]
}

enum LegType {
  PRODUCTION_TO_DC
  DC_TO_DC
  DC_TO_RETAIL
  DC_TO_LASTMILE
}
```

### 3. Операционные данные

```prisma
model Trip {
  id                String   @id @default(cuid())
  tripNumber        String   @unique
  
  supplyChainLegId  String?
  routeId           String?
  originId          String
  destinationId     String
  vehicleId         String?
  carrierId         String?
  driverName        String?
  driverPhone       String?
  
  plannedDeparture  DateTime?
  plannedArrival    DateTime?
  actualDeparture   DateTime?
  actualArrival     DateTime?
  
  actualCost        Decimal? @db.Decimal(12, 2)
  
  plannedPallets    Int?
  plannedWeightKg   Decimal? @db.Decimal(10, 2)
  actualPallets     Int?
  actualWeightKg    Decimal? @db.Decimal(10, 2)
  
  tempRequiredMin   Decimal? @db.Decimal(4, 1)
  tempRequiredMax   Decimal? @db.Decimal(4, 1)
  
  status            TripStatus @default(PLANNED)
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  supplyChainLeg    SupplyChainLeg? @relation(fields: [supplyChainLegId], references: [id])
  route             Route?   @relation(fields: [routeId], references: [id])
  origin            Location @relation("TripOrigin", fields: [originId], references: [id])
  destination       Location @relation("TripDestination", fields: [destinationId], references: [id])
  vehicle           Vehicle? @relation(fields: [vehicleId], references: [id])
  carrier           Carrier? @relation(fields: [carrierId], references: [id])
  
  cargoUnits        TripCargoUnit[]
  qualityEvents     QualityEvent[]
  carrierActTrips   CarrierActTrip[]
}

enum TripStatus {
  PLANNED
  IN_TRANSIT
  COMPLETED
  CANCELLED
}

model CargoUnit {
  id              String   @id @default(cuid())
  barcode         String   @unique
  unitType        CargoUnitType
  verticalId      String?
  customerId      String?
  isMixed         Boolean  @default(false)
  parentUnitId    String?
  weightKg        Decimal? @db.Decimal(10, 2)
  volumeM3        Decimal? @db.Decimal(10, 4)
  productCategory String?
  skuList         Json?
  tempRequiredMin Decimal? @db.Decimal(4, 1)
  tempRequiredMax Decimal? @db.Decimal(4, 1)
  cargoValue      Decimal? @db.Decimal(12, 2)
  status          CargoUnitStatus @default(CREATED)
  createdAt       DateTime @default(now())
  
  vertical        Vertical? @relation(fields: [verticalId], references: [id])
  customer        Customer? @relation(fields: [customerId], references: [id])
  parentUnit      CargoUnit? @relation("MixedPallet", fields: [parentUnitId], references: [id])
  childUnits      CargoUnit[] @relation("MixedPallet")
  tripCargoUnits  TripCargoUnit[]
}

enum CargoUnitType {
  PALLET
  BOX
  CARTON
}

enum CargoUnitStatus {
  CREATED
  IN_TRANSIT
  DELIVERED
  RETURNED
  DISPOSED
}

model TripCargoUnit {
  id            String   @id @default(cuid())
  tripId        String
  cargoUnitId   String
  verticalId    String?
  customerId    String?
  unitType      CargoUnitType
  weightKg      Decimal? @db.Decimal(10, 2)
  costSharePct  Decimal? @db.Decimal(7, 4)
  allocatedCost Decimal? @db.Decimal(12, 2)
  tariffId      String?
  billedAmount  Decimal? @db.Decimal(12, 2)
  loadedAt      DateTime?
  unloadedAt    DateTime?
  
  trip          Trip      @relation(fields: [tripId], references: [id])
  cargoUnit     CargoUnit @relation(fields: [cargoUnitId], references: [id])
  customerActTrips CustomerActTrip[]
}

model QualityEvent {
  id              String   @id @default(cuid())
  tripId          String
  eventType       QualityEventType
  severity        Severity
  eventTime       DateTime?
  locationLat     Decimal? @db.Decimal(9, 6)
  locationLon     Decimal? @db.Decimal(9, 6)
  tempRecorded    Decimal? @db.Decimal(4, 1)
  tempRequiredMin Decimal? @db.Decimal(4, 1)
  tempRequiredMax Decimal? @db.Decimal(4, 1)
  durationMinutes Int?
  delayMinutes    Int?
  description     String?
  resolution      String?
  resolvedAt      DateTime?
  createdAt       DateTime @default(now())
  
  trip            Trip     @relation(fields: [tripId], references: [id])
}

enum QualityEventType {
  LATE_DEPARTURE
  LATE_ARRIVAL
  TEMP_VIOLATION
  CARGO_DAMAGE
  ROUTE_DEVIATION
  VEHICLE_BREAKDOWN
  DOCUMENTATION_ISSUE
}

enum Severity {
  MINOR
  MAJOR
  CRITICAL
}
```

#### Операционные правила (инварианты)

**Точки рейса (`Trip.originId` / `Trip.destinationId`).** Поля nullable: черновик (`DRAFT`) допустимо создавать без точек. При переходе в `PLANNED` и далее обе точки обязательны — инвариант проверяется в `assertRequiredForPlanned` (`src/lib/actions/trips.ts`); прямой записи nullable-значений в `PLANNED+` быть не должно.

**Тип ТС.** Авторитетный источник — тип назначенного транспортного средства (`Trip.vehicle.vehicleType`, факт). Плановый `Trip.vehicleTypeCode` — лишь подсказка на стадии черновика, пока ТС не назначено. В UI используется хелпер `effectiveVehicleType(trip)` = `vehicle.vehicleType.name || vehicleType.name || '—'` (факт приоритетнее плана).

**Даты заявки и плеч.** Операционная правда — даты плеч: `RequestCargoLeg.plannedPickup` / `plannedDropoff` (+ соответствующие `*From`/`*To` как `HH:mm`). Поля шапки заявки `CustomerRequest.pickupDate` / `deliveryDate` (+ `*TimeFrom`/`*TimeTo`) — это укрупнённые окна шапки, вторичны относительно плеч. `CustomerRequest.requestDate` — дата регистрации заявки. (Поле `requestedDate` удалено как мёртвое — не заполнялось и не имело ввода в форме.)

### 4. Финансы

```prisma
model CarrierAct {
  id               String   @id @default(cuid())
  actNumber        String   @unique
  carrierId        String
  periodFrom       DateTime
  periodTo         DateTime
  actDate          DateTime
  amount           Decimal  @db.Decimal(14, 2)
  vatAmount        Decimal? @db.Decimal(14, 2)
  totalAmount      Decimal  @db.Decimal(14, 2)
  status           CarrierActStatus @default(DRAFT)
  discrepancyAmount Decimal? @db.Decimal(14, 2)
  discrepancyNote  String?
  documentUrl      String?
  createdAt        DateTime @default(now())
  verifiedAt       DateTime?
  verifiedBy       String?
  
  carrier          Carrier  @relation(fields: [carrierId], references: [id])
  trips            CarrierActTrip[]
  invoices         CarrierInvoice[]
}

enum CarrierActStatus {
  DRAFT
  RECEIVED
  VERIFIED
  APPROVED
  DISPUTED
}

model CarrierActTrip {
  id             String   @id @default(cuid())
  actId          String
  tripId         String
  amountInAct    Decimal? @db.Decimal(12, 2)
  amountExpected Decimal? @db.Decimal(12, 2)
  isMatched      Boolean?
  discrepancy    Decimal? @db.Decimal(12, 2)
  
  act            CarrierAct @relation(fields: [actId], references: [id])
  trip           Trip       @relation(fields: [tripId], references: [id])
}

model CarrierInvoice {
  id            String   @id @default(cuid())
  invoiceNumber String
  carrierId     String
  actId         String?
  invoiceDate   DateTime
  dueDate       DateTime?
  amount        Decimal  @db.Decimal(14, 2)
  vatAmount     Decimal? @db.Decimal(14, 2)
  totalAmount   Decimal  @db.Decimal(14, 2)
  status        InvoiceStatus @default(RECEIVED)
  documentUrl   String?
  createdAt     DateTime @default(now())
  
  carrier       Carrier   @relation(fields: [carrierId], references: [id])
  act           CarrierAct? @relation(fields: [actId], references: [id])
  payments      CarrierPaymentInvoice[]
}

enum InvoiceStatus {
  DRAFT
  RECEIVED
  SENT
  APPROVED
  PARTIALLY_PAID
  PAID
  OVERDUE
  CANCELLED
}

model CarrierPayment {
  id            String   @id @default(cuid())
  paymentNumber String
  carrierId     String
  paymentDate   DateTime
  amount        Decimal  @db.Decimal(14, 2)
  paymentMethod PaymentMethod @default(BANK_TRANSFER)
  bankAccount   String?
  status        PaymentStatus @default(PLANNED)
  externalId    String?
  createdAt     DateTime @default(now())
  executedAt    DateTime?
  
  carrier       Carrier  @relation(fields: [carrierId], references: [id])
  invoices      CarrierPaymentInvoice[]
}

enum PaymentMethod {
  BANK_TRANSFER
  CARD
  CASH
}

enum PaymentStatus {
  PLANNED
  SENT
  EXECUTED
  FAILED
}

model CarrierPaymentInvoice {
  id        String   @id @default(cuid())
  paymentId String
  invoiceId String
  amount    Decimal  @db.Decimal(14, 2)
  
  payment   CarrierPayment  @relation(fields: [paymentId], references: [id])
  invoice   CarrierInvoice  @relation(fields: [invoiceId], references: [id])
}

model CustomerAct {
  id           String   @id @default(cuid())
  actNumber    String   @unique
  customerId   String
  contractId   String?
  periodFrom   DateTime
  periodTo     DateTime
  actDate      DateTime
  amount       Decimal  @db.Decimal(14, 2)
  vatAmount    Decimal? @db.Decimal(14, 2)
  totalAmount  Decimal  @db.Decimal(14, 2)
  palletsCount Int?
  weightKg     Decimal? @db.Decimal(10, 2)
  tripsCount   Int?
  status       CustomerActStatus @default(DRAFT)
  documentUrl  String?
  signedUrl    String?
  createdAt    DateTime @default(now())
  sentAt       DateTime?
  signedAt     DateTime?
  
  customer     Customer @relation(fields: [customerId], references: [id])
  trips        CustomerActTrip[]
  invoices     CustomerInvoice[]
}

enum CustomerActStatus {
  DRAFT
  SENT
  SIGNED
  DISPUTED
}

model CustomerActTrip {
  id              String   @id @default(cuid())
  actId           String
  tripCargoUnitId String
  billedAmount    Decimal? @db.Decimal(12, 2)
  unitType        String?
  weightKg        Decimal? @db.Decimal(10, 2)
  tariffApplied   Decimal? @db.Decimal(12, 2)
  
  act             CustomerAct    @relation(fields: [actId], references: [id])
  tripCargoUnit   TripCargoUnit  @relation(fields: [tripCargoUnitId], references: [id])
}

model CustomerInvoice {
  id            String   @id @default(cuid())
  invoiceNumber String   @unique
  customerId    String
  actId         String?
  invoiceDate   DateTime
  dueDate       DateTime?
  amount        Decimal  @db.Decimal(14, 2)
  vatAmount     Decimal? @db.Decimal(14, 2)
  totalAmount   Decimal  @db.Decimal(14, 2)
  status        InvoiceStatus @default(DRAFT)
  sentAt        DateTime?
  paidAt        DateTime?
  documentUrl   String?
  createdAt     DateTime @default(now())
  
  customer      Customer @relation(fields: [customerId], references: [id])
  act           CustomerAct? @relation(fields: [actId], references: [id])
  payments      CustomerPaymentInvoice[]
}

model CustomerPayment {
  id            String   @id @default(cuid())
  paymentNumber String
  customerId    String
  paymentDate   DateTime
  amount        Decimal  @db.Decimal(14, 2)
  paymentMethod PaymentMethod @default(BANK_TRANSFER)
  payerAccount  String?
  status        CustomerPaymentStatus @default(PENDING)
  externalId    String?
  createdAt     DateTime @default(now())
  confirmedAt   DateTime?
  
  customer      Customer @relation(fields: [customerId], references: [id])
  invoices      CustomerPaymentInvoice[]
}

enum CustomerPaymentStatus {
  PENDING
  CONFIRMED
  ALLOCATED
}

model CustomerPaymentInvoice {
  id        String   @id @default(cuid())
  paymentId String
  invoiceId String
  amount    Decimal  @db.Decimal(14, 2)
  
  payment   CustomerPayment  @relation(fields: [paymentId], references: [id])
  invoice   CustomerInvoice  @relation(fields: [invoiceId], references: [id])
}
```

## Интерфейсы

### Навигация (Sidebar)

```
📊 Дашборд
   ├── Обзор
   ├── Стоимость перевозок
   ├── Загрузка ТС
   ├── Качество
   └── Финансы

📦 Операции
   ├── Рейсы
   ├── Грузовые единицы
   └── События качества

📚 Справочники
   ├── Локации
   ├── Транспорт
   ├── Перевозчики
   ├── Маршруты
   ├── Звенья цепи
   ├── Вертикали
   ├── Заказчики
   └── Договоры и тарифы

💰 Финансы
   ├── Акты перевозчиков
   ├── Счета перевозчикам
   ├── Оплаты перевозчикам
   ├── Акты клиентам
   ├── Счета клиентам
   └── Поступления от клиентов

⚙️ Настройки
   ├── Пользователи
   ├── Роли и права
   └── Профиль
```

### Страницы (минимум для MVP)

1. **Авторизация**: `/login` — вход по email/password
2. **Дашборд**: `/` — главная с KPI виджетами
3. **Справочники**: CRUD для каждой сущности
4. **Рейсы**: список + форма создания/редактирования
5. **Финансы**: списки актов, счетов, оплат с возможностью создания

### Адаптивность

- **Desktop** (>1200px): полный sidebar, таблицы с колонками
- **Tablet** (768-1200px): collapsed sidebar, меньше колонок
- **Mobile** (<768px): bottom navigation, карточки вместо таблиц

## Seed данные

Создать при первом запуске:

1. **Admin пользователь**: admin@growfood.pro / Admin123!
2. **Роль Admin** со всеми permissions
3. **Вертикали**: GROWFOOD, PRIEM, RETAIL, VENDING, LAAS
4. **Локации**: Производство Колпино, РЦ Питер, РЦ Москва
5. **Звенья**: Колпино→СПб, Колпино→МСК, СПб→МСК
6. **Тестовые рейсы**: 5-10 рейсов с разными статусами

## Команды

```bash
# Установка
npm install

# База данных
docker-compose up -d  # PostgreSQL
npx prisma migrate dev
npx prisma db seed

# Запуск
npm run dev

# Сборка
npm run build
```

## Docker Compose

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: growfood
      POSTGRES_PASSWORD: growfood123
      POSTGRES_DB: logistics
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Переменные окружения

```env
DATABASE_URL="postgresql://growfood:growfood123@localhost:5432/logistics"
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"
```

## Приоритет разработки

1. **Фаза 1**: Авторизация + база + справочники (Локации, Перевозчики, ТС)
2. **Фаза 2**: Вертикали, Заказчики, Маршруты
3. **Фаза 3**: Рейсы + Грузовые единицы
4. **Фаза 4**: Финансы (акты, счета, оплаты)
5. **Фаза 5**: Дашборды с аналитикой
