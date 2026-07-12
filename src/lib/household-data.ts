export type MemberId = "neelam" | "meer" | "vaani" | "haashi"

export type CategoryId = string

export type TaskStatus = "Pending" | "Done"

export type CalendarView = "week" | "month" | "year"

export type ResetCadence = "none" | "daily" | "weekly"

export type NotificationKind =
  | "digest"
  | "due"
  | "assignment"
  | "security"
  | "missed"

export type HomeControlStatus = "Locked" | "Ready" | "Active" | "Paused"

export interface HouseholdMember {
  id: MemberId
  name: string
  role: string
  avatarIcon: string
  color: string
  pin: string
}

export interface TaskCategory {
  id: CategoryId
  label: string
  shortLabel: string
  color: string
  softColor: string
}

export interface HouseholdTask {
  id: string
  title: string
  assignedTo: MemberId
  category: CategoryId
  startTime: string
  endTime: string
  status: TaskStatus
  communal: boolean
  resetCadence: ResetCadence
  createdBy: MemberId
  externalUrl?: string
  notes?: string
  completedAt?: string
  reopenedAt?: string
  reminder: TaskReminderSettings
}

export interface TaskReminderSettings {
  enabled: boolean
  timings: ReminderTiming[]
  email: boolean
  sms: boolean
}

export type ReminderTiming =
  | "day-before-0930"
  | "morning-of-0930"
  | "15"
  | "30"
  | "60"
  | "120"
  | "1440"
  | "2880"

export interface CategoryReminderPreset {
  categoryId: CategoryId
  timings: ReminderTiming[]
}

export interface MemberReminderProfile {
  memberId: MemberId
  email: string
  phone: string
  emailEnabled: boolean
  smsEnabled: boolean
}

export interface NotificationRecord {
  id: string
  kind: NotificationKind
  title: string
  body: string
  memberId: MemberId
  createdAt: string
}

export interface HomeControl {
  id: string
  label: string
  value: string
  status: HomeControlStatus
}

export interface NotePage {
  id: string
  title: string
  body: string
  updatedAt: string
}

export const HOUSEHOLD_MEMBERS: HouseholdMember[] = [
  {
    id: "neelam",
    name: "Neelam",
    role: "Planning lead",
    avatarIcon: "N",
    color: "#f97316",
    pin: "1234",
  },
  {
    id: "meer",
    name: "Meer",
    role: "College and logistics",
    avatarIcon: "M",
    color: "#14b8a6",
    pin: "1234",
  },
  {
    id: "vaani",
    name: "Vaani",
    role: "School and activities",
    avatarIcon: "V",
    color: "#ec4899",
    pin: "1234",
  },
  {
    id: "haashi",
    name: "Haashi",
    role: "Routines and reminders",
    avatarIcon: "H",
    color: "#6366f1",
    pin: "1234",
  },
]

export const TASK_CATEGORIES: TaskCategory[] = [
  {
    id: "chores",
    label: "General / Chores",
    shortLabel: "Chores",
    color: "#22c55e",
    softColor: "rgba(34, 197, 94, 0.12)",
  },
  {
    id: "classes",
    label: "Classes / Courses",
    shortLabel: "Classes",
    color: "#eab308",
    softColor: "rgba(234, 179, 8, 0.16)",
  },
  {
    id: "payments",
    label: "Payments / Bills",
    shortLabel: "Bills",
    color: "#a855f7",
    softColor: "rgba(168, 85, 247, 0.13)",
  },
  {
    id: "appointments",
    label: "Appointments",
    shortLabel: "Appts",
    color: "#3b82f6",
    softColor: "rgba(59, 130, 246, 0.13)",
  },
]

export const SECURITY_PIN = "2468"

export const STORAGE_KEYS = {
  tasks: "household-planner-tasks-v1",
  categories: "household-planner-categories-v1",
  notes: "household-planner-notes-v1",
  reminderProfiles: "household-planner-reminder-profiles-v1",
  reminderCategoryPresets: "household-planner-reminder-category-presets-v1",
  notifications: "household-planner-notifications-v1",
  controls: "household-planner-controls-v1",
} as const

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export function getMember(memberId: MemberId) {
  return HOUSEHOLD_MEMBERS.find((member) => member.id === memberId)
}

export function getCategory(categoryId: CategoryId) {
  return TASK_CATEGORIES.find((category) => category.id === categoryId)
}

export function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createNotificationId() {
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createNotePageId() {
  return `page-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createCategoryId(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function defaultTaskReminder(): TaskReminderSettings {
  return {
    enabled: false,
    timings: [],
    email: true,
    sms: false,
  }
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfWeek(date: Date) {
  const start = startOfDay(date)
  start.setDate(start.getDate() - start.getDay())
  return start
}

export function isSameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

export function isSameMonth(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth()
  )
}

export function toDateTimeInputValue(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function fromDateTimeInputValue(value: string) {
  return new Date(value).toISOString()
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function formatShortDate(value: string | Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(typeof value === "string" ? new Date(value) : value)
}

export function formatFullDate(value: string | Date) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(typeof value === "string" ? new Date(value) : value)
}

export function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(value)
}

export function sortTasks(tasks: HouseholdTask[]) {
  return [...tasks].sort(
    (first, second) =>
      new Date(first.startTime).getTime() - new Date(second.startTime).getTime()
  )
}

export function tasksForDate(tasks: HouseholdTask[], date: Date) {
  return sortTasks(
    tasks.filter((task) => isSameDay(new Date(task.startTime), date))
  )
}

export function tasksForMember(tasks: HouseholdTask[], memberId: MemberId) {
  return sortTasks(tasks.filter((task) => task.assignedTo === memberId))
}

export function completionRate(tasks: HouseholdTask[]) {
  if (tasks.length === 0) {
    return 0
  }

  const done = tasks.filter((task) => task.status === "Done").length
  return Math.round((done / tasks.length) * 100)
}

export function upcomingTasks(tasks: HouseholdTask[], limit = 5) {
  const now = Date.now()
  return sortTasks(
    tasks.filter(
      (task) => task.status === "Pending" && new Date(task.startTime).getTime() >= now
    )
  ).slice(0, limit)
}

function dateAt(offsetDays: number, hour: number, minute = 0) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, minute, 0, 0)
  return date
}

function task(
  id: string,
  title: string,
  assignedTo: MemberId,
  category: CategoryId,
  offsetDays: number,
  hour: number,
  options: Partial<HouseholdTask> = {}
): HouseholdTask {
  const start = dateAt(offsetDays, hour)
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + 45)

  return {
    id,
    title,
    assignedTo,
    category,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: "Pending",
    communal: false,
    resetCadence: "none",
    createdBy: "neelam",
    reminder: defaultTaskReminder(),
    ...options,
  }
}

export function buildSeedTasks(): HouseholdTask[] {
  const completedAt = dateAt(0, 8).toISOString()

  return [
    task("task-trash", "Trash cans and recycling curb check", "haashi", "chores", 0, 7, {
      communal: true,
      resetCadence: "weekly",
      status: "Done",
      completedAt,
    }),
    task("task-college", "College list review", "meer", "classes", 0, 10, {
      createdBy: "neelam",
      externalUrl: "https://meet.google.com/",
    }),
    task("task-ladwp", "LADWP bill payment", "neelam", "payments", 0, 15, {
      createdBy: "neelam",
    }),
    task("task-nutrition", "Gut health nutritionist", "vaani", "appointments", 1, 11, {
      externalUrl: "https://practicebetter.io/",
    }),
    task("task-robotics", "Robotics mentor session", "meer", "classes", 2, 16, {
      externalUrl: "https://meet.google.com/",
    }),
    task("task-furniture", "Outside furniture shopping", "neelam", "chores", -1, 18, {
      status: "Done",
      completedAt,
    }),
    task("task-dmv", "Tesla DMV fees", "meer", "payments", 4, 9, {
      createdBy: "neelam",
    }),
    task("task-dentist", "Dentist appointment", "vaani", "appointments", 5, 14, {
      externalUrl: "https://calendar.google.com/",
    }),
    task("task-garage", "Garage cleanup zone one", "meer", "chores", 6, 9, {
      communal: true,
      resetCadence: "weekly",
    }),
    task("task-plants", "Water indoor plants", "vaani", "chores", 0, 19, {
      communal: true,
      resetCadence: "daily",
    }),
    task("task-adu", "ADU electric and water review", "neelam", "payments", 8, 13),
  ]
}

export function buildSeedNotifications(): NotificationRecord[] {
  const now = new Date().toISOString()

  return [
    {
      id: "note-digest",
      kind: "digest",
      title: "Morning digest ready",
      body: "Today has chores, one class checkpoint, and one bill reminder.",
      memberId: "neelam",
      createdAt: now,
    },
    {
      id: "note-assignment",
      kind: "assignment",
      title: "Assignment alert",
      body: "College List Review was sent to Meer.",
      memberId: "meer",
      createdAt: now,
    },
  ]
}

export function buildSeedControls(): HomeControl[] {
  return [
    {
      id: "sprinklers",
      label: "Sprinklers",
      value: "Tonight 8:00 PM",
      status: "Ready",
    },
    {
      id: "climate",
      label: "Climate",
      value: "Eco 73 F",
      status: "Active",
    },
    {
      id: "locks",
      label: "Entry controls",
      value: "Secured",
      status: "Locked",
    },
  ]
}

export function buildSeedNotes(): NotePage[] {
  return [
    {
      id: "note-household",
      title: "Household Notes",
      body: "Add shared notes, links, packing lists, or anything that should live outside the calendar.",
      updatedAt: new Date().toISOString(),
    },
  ]
}

export function buildSeedReminderProfiles(): MemberReminderProfile[] {
  return HOUSEHOLD_MEMBERS.map((member) => ({
    memberId: member.id,
    email: "",
    phone: "",
    emailEnabled: true,
    smsEnabled: false,
  }))
}

export function buildSeedCategoryReminderPresets(): CategoryReminderPreset[] {
  return [
    {
      categoryId: "classes",
      timings: ["day-before-0930", "morning-of-0930", "30"],
    },
    { categoryId: "payments", timings: ["2880"] },
    { categoryId: "appointments", timings: ["1440", "30"] },
  ]
}
