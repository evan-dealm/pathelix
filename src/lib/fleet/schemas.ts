import { z } from 'zod'
import { DEFECT_CATEGORIES, PLAN_KINDS } from './maintenance'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const PlanFields = {
  kind:        z.enum(PLAN_KINDS),
  label:       z.string().trim().min(1).max(120),
  everyKm:     z.number().int().min(500).max(1_000_000).nullable().optional(),
  everyMonths: z.number().int().min(1).max(120).nullable().optional(),
  lastDoneAt:  day.nullable().optional(),
  lastDoneKm:  z.number().int().min(0).nullable().optional(),
  dueDate:     day.nullable().optional(),
  warnDays:    z.number().int().min(0).max(365).optional(),
  warnKm:      z.number().int().min(0).max(100_000).optional(),
  active:      z.boolean().optional(),
}

export const PlanSchema = z.object({ vehicleId: z.string().min(1), ...PlanFields })
  .refine(p => p.everyKm || p.everyMonths || p.dueDate, { message: 'Indiquez une périodicité (km ou mois) ou une échéance' })

export const PlanUpdateSchema = z.object(PlanFields).partial()

export const MaintenanceSchema = z.object({
  vehicleId:   z.string().min(1),
  type:        z.enum(['inspection', 'oil_change', 'repair', 'tire', 'breakdown', 'other']),
  description: z.string().max(1000).default(''),
  costEur:     z.number().min(0).optional().nullable(),
  mileageKm:   z.number().int().min(0).optional().nullable(),
  doneAt:      day,
  doneBy:      z.string().max(200).default(''),
  notes:       z.string().max(2000).default(''),
  planId:      z.string().min(1).optional(),
  defectIds:   z.array(z.string().min(1)).max(50).optional(),
  nextDueDate: day.optional(),
})

export const DefectSchema = z.object({
  /** Staff: required. Driver: defaults to the truck assigned to them. */
  vehicleId:   z.string().min(1).optional(),
  severity:    z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  category:    z.enum(DEFECT_CATEGORIES).default('OTHER'),
  description: z.string().trim().min(3).max(1000),
  mileageKm:   z.number().int().min(0).max(5_000_000).optional(),
})

export const DefectUpdateSchema = z.object({
  status:     z.enum(['OPEN', 'IN_REPAIR', 'FIXED', 'DISMISSED']).optional(),
  severity:   z.enum(['MINOR', 'MAJOR', 'CRITICAL']).optional(),
  resolution: z.string().max(1000).optional(),
})
