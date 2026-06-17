import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseCSVFile, generateTemplate } from '../exportUtils'
import type { ExportColumn } from '../exportUtils'
import {
  parseDriverRows,
  parseMissionRows,
  parseVehicleRows,
  parseExutoireRows,
  parseClientRows,
  parseSiteRows,
  DRIVER_COLUMNS,
  MISSION_COLUMNS,
  VEHICLE_COLUMNS,
  EXUTOIRE_COLUMNS,
  CLIENT_COLUMNS,
  SITE_COLUMNS,
  missionExportData,
} from '../importExportColumns'

describe('exportCSV', () => {
  let appendChildSpy: ReturnType<typeof vi.fn>
  let removeChildSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.fn>
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let createdAnchor: Record<string, unknown>

  beforeEach(() => {
    clickSpy = vi.fn()
    createdAnchor = { click: clickSpy, href: '', download: '' }
    appendChildSpy = vi.fn()
    removeChildSpy = vi.fn()

    vi.stubGlobal('document', {
      createElement: vi.fn(() => createdAnchor),
      body: { appendChild: appendChildSpy, removeChild: removeChildSpy },
    })

    createObjectURLSpy = vi.fn(() => 'blob:fake-url')
    revokeObjectURLSpy = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    })
    vi.stubGlobal('Blob', class FakeBlob {
      parts: unknown[]
      options: unknown
      constructor(parts: unknown[], options: unknown) {
        this.parts = parts
        this.options = options
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('triggers a download with correct filename', async () => {

    const { exportCSV } = await import('../exportUtils')
    const columns: ExportColumn[] = [
      { key: 'name', header: 'Nom' },
      { key: 'age', header: 'Age' },
    ]
    const rows = [{ name: 'Alice', age: 30 }]
    exportCSV(columns, rows, 'test')

    expect(appendChildSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(removeChildSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalled()
    expect(createdAnchor.download).toBe('test.csv')
  })

  it('applies format functions in CSV output', async () => {
    const { exportCSV } = await import('../exportUtils')
    const columns: ExportColumn[] = [
      { key: 'val', header: 'Value', format: (v) => `formatted:${v}` },
    ]
    const rows = [{ val: 42 }]
    exportCSV(columns, rows, 'formatted')

    const blobArgs = (createObjectURLSpy.mock.calls[0][0] as { parts: string[] }).parts
    const csv = blobArgs[0] as string
    expect(csv).toContain('formatted:42')
  })
})

describe('exportExcel', () => {
  beforeEach(() => {
    vi.stubGlobal('Blob', class FakeBlob {
      constructor(public parts: unknown[], public options: unknown) {}
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ click: vi.fn(), href: '', download: '' })),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates workbook with correct sheet name and data', async () => {
    const addRowSpy = vi.fn()
    const getRowSpy = vi.fn(() => ({
      font: {},
      fill: {},
      alignment: {},
      height: 0,
    }))

    vi.doMock('exceljs', () => ({
      Workbook: class {
        creator = ''
        created: Date | null = null
        xlsx = { writeBuffer: vi.fn(async () => new ArrayBuffer(0)) }
        addWorksheet = vi.fn(() => ({
          columns: [],
          getRow: getRowSpy,
          addRow: addRowSpy,
          autoFilter: null,
        }))
      },
    }))

    const { exportExcel } = await import('../exportUtils')

    const columns: ExportColumn[] = [
      { key: 'name', header: 'Nom' },
    ]
    const rows = [{ name: 'Bob' }]

    await exportExcel(columns, rows, 'feuille')

    expect(addRowSpy).toHaveBeenCalledWith({ name: 'Bob' })

    vi.doUnmock('exceljs')
  })
})

describe('parseCSVFile', () => {
  it('parses semicolon-separated CSV', () => {
    const csv = 'Nom;Age\nAlice;30\nBob;25'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ nom: 'Alice', age: '30' })
    expect(rows[1]).toEqual({ nom: 'Bob', age: '25' })
  })

  it('parses comma-separated CSV', () => {
    const csv = 'Name,Age\nAlice,30'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ name: 'Alice', age: '30' })
  })

  it('strips BOM from CSV', () => {
    const csv = '\uFEFFNom;Age\nAlice;30'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].nom).toBe('Alice')
  })

  it('handles quoted fields with separator inside', () => {
    const csv = 'Nom;Adresse\nAlice;"10 rue; Paris"'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].adresse).toBe('10 rue; Paris')
  })

  it('handles quoted fields with double quotes', () => {
    const csv = 'Nom;Note\nAlice;"dit ""bonjour"""'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].note).toBe('dit bonjour')
  })

  it('returns empty array for single-line CSV (no data)', () => {
    const csv = 'Nom;Age'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(0)
  })

  it('returns empty array for empty string', () => {
    const rows = parseCSVFile('')
    expect(rows).toHaveLength(0)
  })

  it('skips empty rows', () => {
    const csv = 'Nom;Age\nAlice;30\n;;\nBob;25'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(2)
  })

  it('normalizes headers to lowercase without special chars', () => {
    const csv = 'Pr\u00e9nom;N\u00b0 Tel\nJean;0601'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveProperty('prnom')
    expect(rows[0]).toHaveProperty('ntel')
  })

  it('handles Windows-style CRLF line endings', () => {
    const csv = 'Nom;Age\r\nAlice;30\r\nBob;25'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(2)
  })
})

describe('generateTemplate', () => {
  it('generates semicolon-separated header line', () => {
    const columns: ExportColumn[] = [
      { key: 'a', header: 'Colonne A' },
      { key: 'b', header: 'Colonne B' },
    ]
    const result = generateTemplate(columns)
    expect(result).toBe('Colonne A;Colonne B')
  })

  it('escapes headers containing semicolons', () => {
    const columns: ExportColumn[] = [
      { key: 'a', header: 'Col;A' },
    ]
    const result = generateTemplate(columns)
    expect(result).toBe('"Col;A"')
  })

  it('generates correct template for DRIVER_COLUMNS', () => {
    const template = generateTemplate(DRIVER_COLUMNS)
    expect(template).toContain('Prenom')
    expect(template).toContain('Nom')
    expect(template).toContain('Secteur')
    expect(template.split(';')).toHaveLength(DRIVER_COLUMNS.length)
  })

  it('generates correct template for MISSION_COLUMNS', () => {
    const template = generateTemplate(MISSION_COLUMNS)
    expect(template).toContain('Date')
    expect(template).toContain('Type')
    expect(template).toContain('Adresse')
  })

  it('generates correct template for VEHICLE_COLUMNS', () => {
    const template = generateTemplate(VEHICLE_COLUMNS)
    expect(template).toContain('Immatriculation')
    expect(template.split(';')).toHaveLength(VEHICLE_COLUMNS.length)
  })

  it('generates correct template for EXUTOIRE_COLUMNS', () => {
    const template = generateTemplate(EXUTOIRE_COLUMNS)
    expect(template).toContain('Nom')
    expect(template).toContain('Ouverture')
  })

  it('generates correct template for CLIENT_COLUMNS', () => {
    const template = generateTemplate(CLIENT_COLUMNS)
    expect(template).toContain('Nom')
    expect(template).toContain('Email')
  })

  it('generates correct template for SITE_COLUMNS', () => {
    const template = generateTemplate(SITE_COLUMNS)
    expect(template).toContain('Nom')
    expect(template).toContain('Adresse')
  })
})

describe('parseDriverRows', () => {
  it('parses valid driver rows', () => {
    const rows = [
      { prenom: 'Jean', nom: 'Dupont', secteur: 'Nord', depot: 'D\u00e9p\u00f4t A', latitude: '45.76', longitude: '4.83' },
    ]
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('Jean')
    expect(result[0].lastName).toBe('Dupont')
    expect(result[0].sector).toBe('Nord')
    expect(result[0].depotLat).toBeCloseTo(45.76)
    expect(result[0].depotLng).toBeCloseTo(4.83)
  })

  it('accepts flexible header names (firstname, first_name)', () => {
    const rows = [
      { firstname: 'Alice', last_name: 'Martin', sector: 'Sud', depot_name: 'D\u00e9p\u00f4t B', lat: '48.85', lng: '2.35' },
    ]
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('Alice')
    expect(result[0].lastName).toBe('Martin')
    expect(result[0].sector).toBe('Sud')
  })

  it('accepts zone as sector alias', () => {
    const rows = [
      { prenom: 'Luc', nom: 'Petit', zone: 'Est' },
    ]
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].sector).toBe('Est')
  })

  it('filters out rows with no firstName and no lastName', () => {
    const rows = [
      { prenom: '', nom: '', secteur: 'Nord' },
      { prenom: 'Jean', nom: '', secteur: 'Nord' },
    ]
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('Jean')
  })

  it('parses numeric fields with comma decimal separator', () => {
    const rows = [
      { prenom: 'Marie', nom: 'Curie', latitude: '48,85', longitude: '2,35', benne_m3: '30,5' },
    ]
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].depotLat).toBeCloseTo(48.85)
    expect(result[0].maxBinSizeM3).toBeCloseTo(30.5)
  })

  it('handles empty rows gracefully', () => {
    const rows: Record<string, string>[] = []
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(0)
  })

  it('sets optional fields to undefined when missing', () => {
    const rows = [
      { prenom: 'Paul', nom: 'Vidal' },
    ]
    const result = parseDriverRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].phone).toBeUndefined()
    expect(result[0].notes).toBeUndefined()
    expect(result[0].vehicleCapacity).toBeUndefined()
    expect(result[0].maxBinSizeM3).toBeUndefined()
  })

  it('falls back depotName to sector when depot is missing', () => {
    const rows = [
      { prenom: 'Eva', nom: 'Roy', secteur: 'Ouest' },
    ]
    const result = parseDriverRows(rows)
    expect(result[0].depotName).toBe('Ouest')
  })

  it('parses phone from multiple aliases', () => {
    for (const phoneKey of ['telephone', 'phone', 'tel', 'mobile', 'portable']) {
      const rows = [{ prenom: 'A', nom: 'B', [phoneKey]: '0601020304' }]
      const result = parseDriverRows(rows)
      expect(result[0].phone).toBe('0601020304')
    }
  })
})

describe('parseMissionRows', () => {
  const validRow = {
    date: '2026-03-18',
    type: 'POSER',
    adresse: '10 rue de Rivoli, Paris',
    latitude: '48.8566',
    longitude: '2.3522',
    duree_min: '15',
    manoeuvre_min: '5',
  }

  it('parses a valid mission row', () => {
    const result = parseMissionRows([validRow])
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('POSER')
    expect(result[0].date).toBe('2026-03-18')
    expect(result[0].address).toBe('10 rue de Rivoli, Paris')
    expect(result[0].latitude).toBeCloseTo(48.8566)
    expect(result[0].longitude).toBeCloseTo(2.3522)
    expect(result[0].estimatedDurationMin).toBe(15)
    expect(result[0].maneuverTimeMin).toBe(5)
  })

  it('defaults type to POSER when empty', () => {
    const result = parseMissionRows([{ ...validRow, type: '' }])
    expect(result[0].type).toBe('POSER')
  })

  it('uppercases mission type', () => {
    const result = parseMissionRows([{ ...validRow, type: 'retirer' }])
    expect(result[0].type).toBe('RETIRER')
  })

  it('rejects rows with invalid date format', () => {
    const result = parseMissionRows([{ ...validRow, date: '18/03/2026' }])
    expect(result).toHaveLength(0)
  })

  it('rejects rows with missing date', () => {
    const result = parseMissionRows([{ ...validRow, date: '' }])
    expect(result).toHaveLength(0)
  })

  it('defaults duration to 30 and maneuver to 15 when missing', () => {
    const result = parseMissionRows([{
      date: '2026-03-18',
      adresse: 'Test',
    }])
    expect(result).toHaveLength(1)
    expect(result[0].estimatedDurationMin).toBe(30)
    expect(result[0].maneuverTimeMin).toBe(15)
  })

  it('parses time window from ouverture/fermeture', () => {
    const result = parseMissionRows([{
      ...validRow,
      ouverture: '08:00',
      fermeture: '12:00',
    }])
    expect(result[0].timeWindow).toEqual({ openMin: 480, closeMin: 720 })
  })

  it('parses time window from flexible headers', () => {
    const result = parseMissionRows([{
      ...validRow,
      fenetre_ouverture: '09:30',
      fenetre_fermeture: '11:00',
    }])
    expect(result[0].timeWindow).toEqual({ openMin: 570, closeMin: 660 })
  })

  it('does not set timeWindow when only one bound is given', () => {
    const result = parseMissionRows([{
      ...validRow,
      ouverture: '08:00',
    }])
    expect(result[0].timeWindow).toBeUndefined()
  })

  it('parses priority as number', () => {
    const result1 = parseMissionRows([{ ...validRow, priorite: '1' }])
    const result2 = parseMissionRows([{ ...validRow, priorite: '2' }])
    const result3 = parseMissionRows([{ ...validRow, priorite: '3' }])
    expect(result1[0].priority).toBe(1)
    expect(result2[0].priority).toBe(2)
    expect(result3[0].priority).toBe(3)
  })

  it('ignores invalid priority values', () => {
    const result = parseMissionRows([{ ...validRow, priorite: '5' }])
    expect(result[0].priority).toBeUndefined()
  })

  it('accepts flexible header names for address', () => {
    for (const addrKey of ['adresse', 'address', 'addr', 'lieu']) {
      const result = parseMissionRows([{ date: '2026-03-18', [addrKey]: 'Test Addr' }])
      expect(result[0].address).toBe('Test Addr')
    }
  })

  it('accepts flexible header names for client', () => {
    for (const key of ['client', 'clientname', 'client_name', 'nom_client']) {
      const result = parseMissionRows([{ ...validRow, [key]: 'Acme Corp' }])
      expect(result[0].clientName).toBe('Acme Corp')
    }
  })
})

describe('missionExportData', () => {
  it('adds _twClose field from timeWindow', () => {
    const missions = [
      { id: 'm1', timeWindow: { openMin: 480, closeMin: 720 } },
      { id: 'm2' },
    ]
    const result = missionExportData(missions as Parameters<typeof missionExportData>[0])
    expect(result[0]._twClose).toBe('12:00')
    expect(result[1]._twClose).toBe('')
  })
})

describe('parseVehicleRows', () => {
  it('parses valid vehicle rows', () => {
    const rows = [
      { immatriculation: 'AB-123-CD', type: 'PL', marque: 'Renault', modele: 'T480', capacite: '30', kilometrage: '150000' },
    ]
    const result = parseVehicleRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].licensePlate).toBe('AB-123-CD')
    expect(result[0].type).toBe('PL')
    expect(result[0].brand).toBe('Renault')
    expect(result[0].model).toBe('T480')
    expect(result[0].capacityM3).toBe(30)
    expect(result[0].mileageKm).toBe(150000)
  })

  it('accepts flexible header names (licenseplate, plate)', () => {
    const rows = [
      { licenseplate: 'XY-789-ZZ', brand: 'Volvo' },
    ]
    const result = parseVehicleRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].licensePlate).toBe('XY-789-ZZ')
  })

  it('filters out rows with no license plate', () => {
    const rows = [
      { immatriculation: '', type: 'PL' },
      { immatriculation: 'AB-123-CD', type: 'PL' },
    ]
    const result = parseVehicleRows(rows)
    expect(result).toHaveLength(1)
  })

  it('defaults type to PL when missing', () => {
    const rows = [{ immatriculation: 'AB-123-CD' }]
    const result = parseVehicleRows(rows)
    expect(result[0].type).toBe('PL')
  })

  it('defaults axleCount to 2 when missing', () => {
    const rows = [{ immatriculation: 'AB-123-CD' }]
    const result = parseVehicleRows(rows)
    expect(result[0].axleCount).toBe(2)
  })

  it('defaults status to active when missing', () => {
    const rows = [{ immatriculation: 'AB-123-CD' }]
    const result = parseVehicleRows(rows)
    expect(result[0].status).toBe('active')
  })

  it('parses hazmat boolean (oui/true/1)', () => {
    const rows1 = [{ immatriculation: 'AB-1', hazmat: 'Oui' }]
    const rows2 = [{ immatriculation: 'AB-2', hazmat: 'true' }]
    const rows3 = [{ immatriculation: 'AB-3', hazmat: '1' }]
    const rows4 = [{ immatriculation: 'AB-4', hazmat: 'Non' }]

    expect(parseVehicleRows(rows1)[0].hazmat).toBe(true)
    expect(parseVehicleRows(rows2)[0].hazmat).toBe(true)
    expect(parseVehicleRows(rows3)[0].hazmat).toBe(true)
    expect(parseVehicleRows(rows4)[0].hazmat).toBe(false)
  })

  it('parses dimension fields', () => {
    const rows = [{
      immatriculation: 'AB-123-CD',
      poids_tonnes: '19,5',
      hauteur_m: '3,8',
      largeur_m: '2,5',
      longueur_m: '12',
      essieux: '3',
    }]
    const result = parseVehicleRows(rows)
    expect(result[0].weightTon).toBeCloseTo(19.5)
    expect(result[0].heightM).toBeCloseTo(3.8)
    expect(result[0].widthM).toBeCloseTo(2.5)
    expect(result[0].lengthM).toBe(12)
    expect(result[0].axleCount).toBe(3)
  })
})

describe('parseExutoireRows', () => {
  it('parses valid exutoire rows', () => {
    const rows = [{
      nom: 'Centre Tri Nord',
      adresse: '1 rue du Tri',
      latitude: '45.76',
      longitude: '4.83',
      ouverture: '06:00',
      fermeture: '18:00',
      duree_service_min: '10',
      dechets: 'Encombrants|DIB',
    }]
    const result = parseExutoireRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Centre Tri Nord')
    expect(result[0].address).toBe('1 rue du Tri')
    expect(result[0].lat).toBeCloseTo(45.76)
    expect(result[0].lng).toBeCloseTo(4.83)
    expect(result[0].openingHoursOpen).toBe(360)
    expect(result[0].openingHoursClose).toBe(1080)
    expect(result[0].serviceTimeMin).toBe(10)
    expect(result[0].acceptedWasteTypes).toEqual(['Encombrants', 'DIB'])
  })

  it('accepts flexible header names (name, exutoire, centre_tri)', () => {
    for (const nameKey of ['name', 'exutoire', 'centre_tri', 'plateforme']) {
      const rows = [{ [nameKey]: 'Test Site' }]
      const result = parseExutoireRows(rows)
      expect(result[0].name).toBe('Test Site')
    }
  })

  it('filters out rows with no name', () => {
    const rows = [
      { nom: '' },
      { nom: 'Valid' },
    ]
    const result = parseExutoireRows(rows)
    expect(result).toHaveLength(1)
  })

  it('defaults opening hours to 06:00-18:00 when missing', () => {
    const rows = [{ nom: 'Test' }]
    const result = parseExutoireRows(rows)
    expect(result[0].openingHoursOpen).toBe(360)
    expect(result[0].openingHoursClose).toBe(1080)
  })

  it('defaults serviceTimeMin to 15 when missing', () => {
    const rows = [{ nom: 'Test' }]
    const result = parseExutoireRows(rows)
    expect(result[0].serviceTimeMin).toBe(15)
  })

  it('initializes closedDays as empty array', () => {
    const rows = [{ nom: 'Test' }]
    const result = parseExutoireRows(rows)
    expect(result[0].closedDays).toEqual([])
  })

  it('parses waste types separated by comma, pipe, or semicolon', () => {
    const testCases = [
      { dechets: 'A|B|C', expected: ['A', 'B', 'C'] },
      { dechets: 'A,B,C', expected: ['A', 'B', 'C'] },
      { dechets: 'A;B;C', expected: ['A', 'B', 'C'] },
    ]
    for (const tc of testCases) {
      const rows = [{ nom: 'Test', dechets: tc.dechets }]
      const result = parseExutoireRows(rows)
      expect(result[0].acceptedWasteTypes).toEqual(tc.expected)
    }
  })

  it('returns empty acceptedWasteTypes when no waste column', () => {
    const rows = [{ nom: 'Test' }]
    const result = parseExutoireRows(rows)
    expect(result[0].acceptedWasteTypes).toEqual([])
  })
})

describe('parseClientRows', () => {
  it('parses valid client rows', () => {
    const rows = [{
      nom: 'Acme Corp',
      contact: 'Jean Dupont',
      telephone: '0601020304',
      email: 'jean@acme.com',
      vip: 'Oui',
      bsd: 'Non',
      notes: 'Client important',
    }]
    const result = parseClientRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Acme Corp')
    expect(result[0].contact).toBe('Jean Dupont')
    expect(result[0].phone).toBe('0601020304')
    expect(result[0].email).toBe('jean@acme.com')
    expect(result[0].vip).toBe(true)
    expect(result[0].requiresBsd).toBe(false)
    expect(result[0].notes).toBe('Client important')
  })

  it('accepts flexible header names (client, raison_sociale, societe)', () => {
    for (const nameKey of ['client', 'raison_sociale', 'societe']) {
      const rows = [{ [nameKey]: 'Test Corp' }]
      const result = parseClientRows(rows)
      expect(result[0].name).toBe('Test Corp')
    }
  })

  it('filters out rows with no name', () => {
    const rows = [
      { nom: '' },
      { nom: 'Valid Corp' },
    ]
    const result = parseClientRows(rows)
    expect(result).toHaveLength(1)
  })

  it('defaults boolean fields to false', () => {
    const rows = [{ nom: 'Test Corp' }]
    const result = parseClientRows(rows)
    expect(result[0].vip).toBe(false)
    expect(result[0].requiresBsd).toBe(false)
  })

  it('parses vip with various truthy values', () => {
    for (const val of ['oui', 'true', '1', 'yes', 'vrai']) {
      const rows = [{ nom: 'Test', vip: val }]
      const result = parseClientRows(rows)
      expect(result[0].vip).toBe(true)
    }
  })

  it('accepts contact alias interlocuteur', () => {
    const rows = [{ nom: 'Test', interlocuteur: 'Marie' }]
    const result = parseClientRows(rows)
    expect(result[0].contact).toBe('Marie')
  })
})

describe('parseSiteRows', () => {
  it('parses valid site rows', () => {
    const rows = [{
      nom: 'Chantier Nord',
      adresse: '15 rue du Chantier',
      latitude: '45.76',
      longitude: '4.83',
      secteur: 'Nord',
      manoeuvre_min: '20',
      notes_acces: 'Portail code 1234',
    }]
    const result = parseSiteRows(rows)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Chantier Nord')
    expect(result[0].address).toBe('15 rue du Chantier')
    expect(result[0].latitude).toBeCloseTo(45.76)
    expect(result[0].longitude).toBeCloseTo(4.83)
    expect(result[0].sector).toBe('Nord')
    expect(result[0].defaultManeuverMin).toBe(20)
    expect(result[0].accessNotes).toBe('Portail code 1234')
  })

  it('accepts flexible header names (site, chantier, lieu)', () => {
    for (const nameKey of ['site', 'chantier', 'lieu']) {
      const rows = [{ [nameKey]: 'Test Site' }]
      const result = parseSiteRows(rows)
      expect(result[0].name).toBe('Test Site')
    }
  })

  it('filters out rows with no name', () => {
    const rows = [
      { nom: '' },
      { nom: 'Valid Site' },
    ]
    const result = parseSiteRows(rows)
    expect(result).toHaveLength(1)
  })

  it('defaults maneuverMin to 15 when missing', () => {
    const rows = [{ nom: 'Test' }]
    const result = parseSiteRows(rows)
    expect(result[0].defaultManeuverMin).toBe(15)
  })

  it('accepts zone as sector alias', () => {
    const rows = [{ nom: 'Test', zone: 'Nord' }]
    const result = parseSiteRows(rows)
    expect(result[0].sector).toBe('Nord')
  })

  it('defaults string fields to empty string when missing', () => {
    const rows = [{ nom: 'Test' }]
    const result = parseSiteRows(rows)
    expect(result[0].address).toBe('')
    expect(result[0].sector).toBe('')
    expect(result[0].accessNotes).toBe('')
  })
})

describe('parseExcelFile', () => {
  it('returns empty array when sheet has fewer than 2 rows', async () => {
    vi.doMock('exceljs', () => ({
      Workbook: class {
        xlsx = {
          load: vi.fn(async () => {}),
        }
        worksheets = [{
          rowCount: 1,
          getRow: vi.fn(() => ({
            eachCell: vi.fn(),
            hasValues: false,
          })),
        }]
      },
    }))

    const { parseExcelFile } = await import('../exportUtils')
    const fakeFile = {
      arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    } as unknown as File

    const result = await parseExcelFile(fakeFile)
    expect(result).toEqual([])

    vi.doUnmock('exceljs')
  })
})

describe('CSV roundtrip', () => {
  it('generates a template that can be parsed back with matching headers', () => {
    const template = generateTemplate(DRIVER_COLUMNS)

    const csv = template + '\nJean;Dupont;0601;Nord;Depot A;45.76;4.83;2;30;35;RAS;Grue'
    const rows = parseCSVFile(csv)
    expect(rows).toHaveLength(1)

    expect(rows[0]).toHaveProperty('prenom')
    expect(rows[0]).toHaveProperty('nom')
    expect(rows[0]).toHaveProperty('secteur')
  })

  it('driver roundtrip: template → fill → parse → valid driver', () => {
    const template = generateTemplate(DRIVER_COLUMNS)
    const csv = template + '\nMarie;Curie;0602;Est;Depot Est;48.85;2.35;1;20;40;;'
    const rows = parseCSVFile(csv)
    const drivers = parseDriverRows(rows)
    expect(drivers).toHaveLength(1)
    expect(drivers[0].firstName).toBe('Marie')
    expect(drivers[0].lastName).toBe('Curie')
    expect(drivers[0].sector).toBe('Est')
  })
})
