export interface HouseholdUser {
  _id: string
  name: string
  role: string
  avatarIcon: string
  color: string
  sortOrder: number
}

export interface HouseholdTask {
  _id: string
  title: string
  assignedTo: string
  category: string
  startTime: number
  endTime: number
  status: "Pending" | "Done"
  communal: boolean
  resetCadence: "none" | "daily" | "weekly"
  createdBy: string
  externalUrl?: string
  notes?: string
  assignedUser?: HouseholdUser | null
}

export interface HouseholdAggregate {
  users: HouseholdUser[]
  tasks: HouseholdTask[]
  stats: {
    pending: number
    done: number
    completionRate: number
  }
}

export interface ContactProfile {
  email: string
  phone: string
  emailEnabled: boolean
  smsEnabled: boolean
}
