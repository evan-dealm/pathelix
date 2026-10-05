import { z } from 'zod'

const latitudeSchema  = z.number().min(-90).max(90)
const longitudeSchema = z.number().min(-180).max(180)

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format YYYY-MM-DD requis')
  .refine(d => {
    const [y, mo, day] = d.split('-').map(Number)
    const dt = new Date(y, mo - 1, day)
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === day
  }, 'Date calendaire invalide')

const MissionObjectSchema = z.object({
  type: z.enum(['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR']),
  date: dateSchema,

  address:              z.string().min(1),
  latitude:             latitudeSchema,
  longitude:            longitudeSchema,
  estimatedDurationMin: z.number().int().min(0).max(1440),
  maneuverTimeMin:      z.number().int().min(0),

  clientName:        z.string().optional(),
  outletName:        z.string().optional(),
  wasteTypeLabel:    z.string().optional(),
  binSize:           z.string().optional(),
  binSizeM3:         z.number().positive().optional(),
  accessNotes:       z.string().optional(),
  priority:          z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  timeWindow: z.object({
    openMin:  z.number().int().min(0).max(1439),
    closeMin: z.number().int().min(0).max(1439),
  }).refine(
    tw => tw.closeMin > tw.openMin,
    { message: 'closeMin doit être supérieur à openMin' },
  ).refine(
    tw => tw.closeMin - tw.openMin >= 15,
    { message: 'La fenêtre horaire doit être d\'au moins 15 minutes' },
  ).optional(),
  linkedExutoireId:  z.string().optional(),
  archived:          z.boolean().optional(),

  notes:             z.string().optional(),
  equipmentType:     z.string().optional(),
  clientId:          z.string().optional(),
  siteId:            z.string().optional(),
  productId:         z.string().optional(),
  dependsOnId:       z.string().optional(),
  tags:              z.array(z.string()).optional(),
  voucherDelivered:  z.boolean().optional(),
  requiredSkills:    z.array(z.string()).optional(),
  externalRef:       z.string().optional(),
})

const NOT_USER_CREATABLE_TYPES = new Set(['VIDER', 'PAUSE'])
const notSyntheticType = <T extends { type?: string }>(data: T) =>
  data.type === undefined || !NOT_USER_CREATABLE_TYPES.has(data.type)
const SYNTHETIC_TYPE_ISSUE = {
  message: 'Type VIDER/PAUSE réservé au moteur VRP — ne peut pas être créé ou modifié manuellement',
  path: ['type'],
}

export const MissionSchema = MissionObjectSchema.refine(notSyntheticType, SYNTHETIC_TYPE_ISSUE)
// On update, `priority: null` clears it (an omitted key means "unchanged").
export const MissionUpdateSchema = MissionObjectSchema
  .extend({ priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable() })
  .partial()
  .refine(notSyntheticType, SYNTHETIC_TYPE_ISSUE)

export type MissionInput = z.infer<typeof MissionObjectSchema>
export type MissionUpdateInput = z.infer<typeof MissionUpdateSchema>

export const DriverSchema = z.object({
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  sector:    z.string().min(1),
  depotName: z.string().min(1),
  depotLat:  latitudeSchema,
  depotLng:  longitudeSchema,

  maxBinSizeM3:    z.number().positive().optional(),
  vehicleCapacity: z.number().int().positive().optional(),
  archived:        z.boolean().optional(),
  phone:           z.string().optional(),
  notes:           z.string().optional(),
  skills:          z.array(z.string()).optional(),
  weeklyHoursMax:  z.number().positive().optional(),

  email:             z.string().email().optional().or(z.literal('')),
  employeeNumber:    z.string().optional(),
  hiredAt:           z.string().datetime({ offset: true }).optional().nullable(),
  birthDate:         z.string().datetime({ offset: true }).optional().nullable(),
  licenseExpiry:     z.string().datetime({ offset: true }).optional().nullable(),
  licenseCategories: z.array(z.string()).optional(),
  emergencyContact:  z.string().optional(),
  color:             z.string().optional(),
  startingExutoireId: z.string().optional().nullable(),
})

export type DriverInput = z.infer<typeof DriverSchema>

export const ExutoireSchema = z.object({
  name:    z.string().min(1),
  address: z.string().min(1),
  lat:     latitudeSchema,
  lng:     longitudeSchema,

  openingHoursOpen:  z.number().int().min(0).max(1439),
  openingHoursClose: z.number().int().min(0).max(1439),

  closedDays:         z.array(z.number().int().min(0).max(6)),
  acceptedWasteTypes: z.array(z.string()),
  serviceTimeMin:     z.number().int().min(0),
})

export type ExutoireInput = z.infer<typeof ExutoireSchema>

export const OptimizeRequestSchema = z.object({
  date: dateSchema,

  driverIds: z.array(z.string()).optional(),

  existingPlans: z.record(z.string(), z.array(z.string())).optional(),

  options: z.object({
    // Borné à 5 min : un budget arbitraire monopoliserait le worker (ou pire,
    // le process web en mode fallback synchrone)
    timeBudgetMs:    z.number().int().positive().max(300_000).optional(),
    seed:            z.number().int().optional(),
    lnsIterations:   z.number().int().positive().max(100_000).optional(),
    lnsDestroyRatio: z.number().min(0).max(1).optional(),
    verboseLog:      z.boolean().optional(),
    usePareto:       z.boolean().optional(),
    weights: z.object({
      distance:    z.number().min(0).max(2),
      punctuality: z.number().min(0).max(2),
      balance:     z.number().min(0).max(2),
      stability:   z.number().min(0).max(2).optional(),
    }).optional(),
  }).optional(),
})

export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>

const PlannedMissionSchema = z.object({
  id:                   z.string(),
  type:                 z.enum(['POSER', 'RETIRER', 'ECHANGER', 'VIDER', 'PAUSE', 'CHARGER_IMMEDIAT', 'DEPLACER', 'TASSER', 'EXPEDIER', 'ALLER_RETOUR']),
  date:                 z.string(),
  address:              z.string(),
  latitude:             z.number(),
  longitude:            z.number(),
  estimatedDurationMin: z.number(),
  maneuverTimeMin:      z.number(),
  sequenceOrder:        z.number(),

  clientName:        z.string().optional(),
  outletName:        z.string().optional(),
  wasteTypeLabel:    z.string().optional(),
  binSize:           z.string().optional(),
  binSizeM3:         z.number().optional(),
  accessNotes:       z.string().optional(),
  priority:          z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  timeWindow: z.object({
    openMin:  z.number().int().min(0).max(1439),
    closeMin: z.number().int().min(0).max(1439),
  }).optional(),
  linkedExutoireId:  z.string().optional(),
  archived:          z.boolean().optional(),
  isSynthetic:          z.boolean().optional(),
  manualStartMin:       z.number().optional(),
  precomputedTravelMin: z.number().optional(),
})

export const PlanSchema = z.object({
  driverId:  z.string().min(1),
  date:      dateSchema,
  missions:  z.array(PlannedMissionSchema),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  speedKmh:  z.number().positive().optional(),
})

export type PlanInput = z.infer<typeof PlanSchema>

export const LoginSchema = z.object({
  password: z.string().min(1).max(1000, 'Mot de passe trop long'),
  email:    z.string().min(1).max(254).email().optional(),
})

export type LoginInput = z.infer<typeof LoginSchema>

export const UserCreateSchema = z.object({
  email:     z.string().email(),
  password:  z.string().min(12, 'Le mot de passe doit contenir au moins 12 caractères').max(1000),
  role:      z.enum(['ADMIN', 'DISPATCHER', 'DRIVER']),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  driverRef: z.string().optional(),
})

export type UserCreateInput = z.infer<typeof UserCreateSchema>

export const UserUpdateSchema = z.object({
  email:     z.string().email().optional(),
  password:  z.string().min(12).max(1000).optional(),
  role:      z.enum(['ADMIN', 'DISPATCHER', 'DRIVER']).optional(),
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
  driverRef: z.string().nullable().optional(),
})

export type UserUpdateInput = z.infer<typeof UserUpdateSchema>

export const VehicleSchema = z.object({
  licensePlate:    z.string().min(1),
  type:            z.string().min(1),
  brand:           z.string().optional(),
  model:           z.string().optional(),
  // Nullable = the field can be cleared from the edit form (undefined means "unchanged").
  capacityM3:      z.number().positive().nullable().optional(),
  maxBins:         z.number().int().positive().nullable().optional(),
  mileageKm:       z.number().int().min(0).optional(),
  nextInspection:  dateSchema.nullable().optional(),
  status:          z.enum(['active', 'maintenance', 'decommissioned']).optional(),
  notes:           z.string().optional(),
  assignedDriverId: z.string().nullable().optional(),
  archived:        z.boolean().optional(),

  tollClass:       z.number().int().min(1).max(5).optional(),
  telepayBadge:    z.string().optional(),
  telepayDiscount: z.number().min(0).max(100).optional(),

  gabaritProfile:  z.string().optional(),
  weightTon:       z.number().min(1).max(100).optional(),
  heightM:         z.number().min(1).max(6).optional(),
  widthM:          z.number().min(1).max(4).optional(),
  lengthM:         z.number().min(2).max(30).optional(),
  axleCount:       z.number().int().min(2).max(10).optional(),
  hazmat:          z.boolean().optional(),

  fuelType:        z.enum(['diesel', 'essence', 'electrique', 'hybride', 'gpl', '']).optional(),
  year:            z.number().int().min(1900).max(2100).nullable().optional(),
  vin:             z.string().nullable().optional(),
  color:           z.string().optional(),

  gpsDeviceId:     z.string().nullable().optional(),

  insuranceExpiry: dateSchema.nullable().optional(),
  insuranceRef:    z.string().optional(),

  lastServiceDate: dateSchema.nullable().optional(),
  lastServiceKm:   z.number().int().min(0).nullable().optional(),
})

export type VehicleInput = z.infer<typeof VehicleSchema>

export const HolidaySchema = z.object({
  date:      dateSchema,
  label:     z.string().min(1),
  recurring: z.boolean().optional(),
})

export type HolidayInput = z.infer<typeof HolidaySchema>

export const TenantSettingsSchema = z.object({

  defaultSpeedKmh:    z.number().positive().optional(),
  defaultStartTime:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxWorkDayMin:      z.number().int().positive().optional(),
  pauseAfterMin:      z.number().int().positive().optional(),
  pauseDurationMin:   z.number().int().positive().optional(),
  costPerKm:          z.number().min(0).optional(),
  fuelCostPerLiter:   z.number().min(0).optional(),
  consumptionLPer100: z.number().min(0).optional(),

  primaryColor:       z.string().optional(),
  logoUrl:            z.string().optional(),
  companyDisplayName: z.string().optional(),

  timezone:           z.string().optional(),
  locale:             z.string().optional(),

  notificationsEnabled: z.boolean().optional(),
  smsEnabled:           z.boolean().optional(),
  emailEnabled:         z.boolean().optional(),

  invoicePrefix:  z.string().optional(),
  vatNumber:      z.string().optional(),
  billingEmail:   z.string().optional(),
  supportEmail:   z.string().optional(),

  maxOptimizationsPerDay: z.number().int().min(1).optional(),

  valhallaFactor: z.number().min(0.5).max(3.0).optional(),
})

export type TenantSettingsInput = z.infer<typeof TenantSettingsSchema>

export const DriverUnavailabilitySchema = z.object({
  driverId:  z.string().min(1),
  startDate: dateSchema,
  endDate:   dateSchema,
  reason:    z.enum(['conge', 'maladie', 'formation', 'autre']),
  notes:     z.string().optional(),
}).refine(
  d => d.endDate >= d.startDate,
  { message: 'endDate doit être >= startDate' },
)

export type DriverUnavailabilityInput = z.infer<typeof DriverUnavailabilitySchema>
