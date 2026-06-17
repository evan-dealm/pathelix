type MockVehicle = Record<string, unknown> & { id: string; tenantId: string; archived?: boolean }

let _store: MockVehicle[] | null = null

export function getVehicleStore(): MockVehicle[] {
  if (!_store) _store = []
  return _store
}
