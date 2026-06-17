export type BsdType = 'BSDD' // Extensible: | 'BSDA' | 'BSFF' | 'BSDASRI'

export type BsdSignatureType = 'PRODUCER' | 'TRANSPORTER'

export interface TdCompany {
  siret:    string
  name:     string
  address:  string
  contact?: string
  phone?:   string
  mail?:    string
}

export interface TdWasteDetails {
  code:            string
  name?:           string
  onuCode?:        string
  quantity?:       number
  quantityType?:   'REAL' | 'ESTIMATED'
  consistence?:    'SOLID' | 'LIQUID' | 'GASEOUS' | 'DOUGHY'
  packagingInfos?: Array<{ type: string; quantity: number }>
}

export interface TdTransporter {
  company:              TdCompany
  isExemptedOfReceipt?: boolean
  receipt?:             string
  department?:          string
  validityLimit?:       string
  numberPlate?:         string
}

export interface TdGraphQLError {
  message:     string
  extensions?: { code?: string }
}

export interface TdGraphQLResponse<T> {
  data?:   T
  errors?: TdGraphQLError[]
}

export interface TdFormResult {
  id:          string
  status:      string
  readableId?: string
}
