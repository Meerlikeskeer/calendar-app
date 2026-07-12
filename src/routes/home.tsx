import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HomeIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  LogInIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  TagsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useAction, useMutation, useQuery } from "convex/react"
import { makeFunctionReference } from "convex/server"
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type MouseEvent,
  type SetStateAction,
} from "react"
import { toast } from "sonner"

import { ThemeMenu } from "@/components/theme-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addDays,
  buildSeedNotifications,
  buildSeedCategoryReminderPresets,
  buildSeedReminderProfiles,
  buildSeedTasks,
  createCategoryId,
  createNotePageId,
  createTaskId,
  defaultTaskReminder,
  formatFullDate,
  formatMonth,
  formatTime,
  fromDateTimeInputValue,
  getMember,
  HOUSEHOLD_MEMBERS,
  isSameDay,
  isSameMonth,
  sortTasks,
  startOfDay,
  startOfWeek,
  STORAGE_KEYS,
  TASK_CATEGORIES,
  tasksForDate,
  toDateTimeInputValue,
  WEEKDAY_LABELS,
} from "@/lib/household-data"
import type {
  CategoryId,
  CategoryReminderPreset,
  HouseholdTask,
  MemberId,
  MemberReminderProfile,
  ResetCadence,
  ReminderTiming,
  TaskStatus,
  NotificationRecord,
  NotePage,
  TaskCategory,
  TaskReminderSettings,
} from "@/lib/household-data"

const convexEnabled = Boolean(import.meta.env.VITE_CONVEX_URL)
const PENDING_CONTACT_PROFILE_KEY = "household-planner-pending-contact-profile"

const householdApi = {
  getCurrentViewer: makeFunctionReference<"query">(
    "household:getCurrentViewer"
  ),
  getMyContactProfile: makeFunctionReference<"query">(
    "household:getMyContactProfile"
  ),
  saveMyContactProfile: makeFunctionReference<"mutation">(
    "household:saveMyContactProfile"
  ),
  changeMyPassword: makeFunctionReference<"action">(
    "household:changeMyPassword"
  ),
  listAggregateTasks: makeFunctionReference<"query">(
    "household:listAggregateTasks"
  ),
  seedDemoHousehold: makeFunctionReference<"mutation">(
    "household:seedDemoHousehold"
  ),
  createTask: makeFunctionReference<"mutation">("household:createTask"),
  updateTask: makeFunctionReference<"mutation">("household:updateTask"),
  toggleTaskDone: makeFunctionReference<"mutation">("household:toggleTaskDone"),
  notifyMissedTask: makeFunctionReference<"mutation">(
    "household:notifyMissedTask"
  ),
  removeTask: makeFunctionReference<"mutation">("household:removeTask"),
}

interface ConvexActions {
  createTask: (task: HouseholdTask) => Promise<void>
  updateTask: (task: HouseholdTask) => Promise<void>
  toggleTaskDone: (taskId: string, status: TaskStatus) => Promise<void>
  notifyMissedTask: (taskId: string) => Promise<void>
  removeTask: (taskId: string) => Promise<void>
}

interface TaskDraft {
  title: string
  assignedTo: MemberId
  category: CategoryId
  startTime: string
  endTime: string
  communal: boolean
  resetCadence: ResetCadence
  externalUrl: string
  notes: string
  reminder: TaskReminderSettings
}

interface ContextMenuState {
  date: Date
  x: number
  y: number
}

const REMINDER_OPTIONS = [
  { label: "Day before at 9:30 AM", value: "day-before-0930" },
  { label: "Morning of at 9:30 AM", value: "morning-of-0930" },
  { label: "15 min before", value: "15" },
  { label: "30 min before", value: "30" },
  { label: "1 hr before", value: "60" },
  { label: "2 hr before", value: "120" },
  { label: "1 day before", value: "1440" },
  { label: "2 days before", value: "2880" },
] as const

function formatReminderTiming(timing: ReminderTiming) {
  return REMINDER_OPTIONS.find((option) => option.value === timing)?.label ?? timing
}

function reminderFromPreset(preset: CategoryReminderPreset | undefined) {
  const timings = preset?.timings ?? []

  return {
    enabled: timings.length > 0,
    timings,
    email: true,
    sms: false,
  } satisfies TaskReminderSettings
}

function usePersistentState<T>(key: string, fallbackFactory: () => T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return fallbackFactory()
    }

    const stored = window.localStorage.getItem(key)

    if (!stored) {
      return fallbackFactory()
    }

    try {
      return JSON.parse(stored) as T
    } catch {
      return fallbackFactory()
    }
  })

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue] as const
}

function buildMonthCells(anchorDate: Date) {
  const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
  const start = startOfWeek(firstOfMonth)

  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function setTimeOnDate(date: Date, hour: number, minute = 0) {
  const next = startOfDay(date)
  next.setHours(hour, minute, 0, 0)
  return next
}

function createDraftForDate(
  date: Date,
  category: CategoryId = "chores",
  assignedTo: MemberId = "neelam"
): TaskDraft {
  const today = new Date()
  const start =
    isSameDay(date, today) && today.getHours() < 21
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), today.getHours() + 1)
      : setTimeOnDate(date, 9)
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + 45)

  return {
    title: "",
    assignedTo,
    category,
    startTime: toDateTimeInputValue(start),
    endTime: toDateTimeInputValue(end),
    communal: false,
    resetCadence: "none",
    externalUrl: "",
    notes: "",
    reminder: defaultTaskReminder(),
  }
}

function draftFromTask(task: HouseholdTask): TaskDraft {
  return {
    title: task.title,
    assignedTo: task.assignedTo,
    category: task.category,
    startTime: toDateTimeInputValue(task.startTime),
    endTime: toDateTimeInputValue(task.endTime),
    communal: task.communal,
    resetCadence: task.resetCadence,
    externalUrl: task.externalUrl ?? "",
    notes: task.notes ?? "",
    reminder: task.reminder ?? defaultTaskReminder(),
  }
}

function normalizeTask(task: HouseholdTask): HouseholdTask {
  const reminder = task.reminder as TaskReminderSettings & {
    offsetMinutes?: number
  }

  return {
    ...task,
    category: task.category === "spiritual" ? "chores" : task.category,
    reminder: reminder
      ? {
          enabled: reminder.enabled,
          timings: Array.isArray(reminder.timings)
            ? reminder.timings
            : [String(reminder.offsetMinutes ?? 30) as ReminderTiming],
          email: reminder.email,
          sms: reminder.sms,
        }
      : defaultTaskReminder(),
  }
}

function isTaskMissed(task: HouseholdTask, now: number) {
  const endTime = new Date(task.endTime).getTime()

  return task.status !== "Done" && Number.isFinite(endTime) && endTime < now
}

function buildMissedNotifications(
  missedTasks: HouseholdTask[],
  existingIds: Set<string>
): NotificationRecord[] {
  const createdAt = new Date().toISOString()
  const records: NotificationRecord[] = []

  for (const task of missedTasks) {
    const assignedMember = getMember(task.assignedTo)

    for (const member of HOUSEHOLD_MEMBERS) {
      if (member.id === task.assignedTo) {
        continue
      }

      const id = `missed-${task.id}-${member.id}`

      if (existingIds.has(id)) {
        continue
      }

      records.push({
        id,
        kind: "missed",
        title: "Missed task alert",
        body: `${assignedMember?.name ?? "Someone"} did not complete ${task.title}.`,
        memberId: member.id,
        createdAt,
      })
    }
  }

  return records
}

function resolveCategory(categories: TaskCategory[], categoryId: CategoryId) {
  return (
    categories.find((category) => category.id === categoryId) ??
    categories[0] ??
    TASK_CATEGORIES[0]
  )
}

function taskAccentStyle(
  task: HouseholdTask,
  categories: TaskCategory[],
  missed: boolean
): CSSProperties {
  if (missed) {
    return {
      borderColor: "#dc2626",
      backgroundColor: "rgba(220, 38, 38, 0.12)",
    }
  }

  const category = resolveCategory(categories, task.category)

  return {
    borderColor: category?.color,
    backgroundColor: category?.softColor,
  }
}

function softColorFromHex(color: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}24` : "rgba(0, 0, 0, 0.08)"
}

function formatReminderSchedule(timings: ReminderTiming[]) {
  return timings.map(formatReminderTiming).join(", ")
}

function CalendarSelect<TValue extends string>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  disabled?: boolean
  onChange: (value: TValue) => void
  options: Array<{
    value: TValue
    label: string
    color?: string
  }>
  value: TValue
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener("pointerdown", closeOnPointer)
    return () => window.removeEventListener("pointerdown", closeOnPointer)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left font-sans text-sm font-normal text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 dark:bg-input/30"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.color && (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selectedOption.color }}
            />
          )}
          <span className="truncate">{selectedOption?.label ?? "Select"}</span>
        </span>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && !disabled && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-[70] max-h-56 overflow-auto rounded-lg border bg-popover p-1 font-sans text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
          role="listbox"
        >
          {options.map((option) => {
            const selected = option.value === value

            return (
              <button
                key={option.value}
                aria-selected={selected}
                className={`flex h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:bg-muted ${
                  selected ? "bg-muted font-medium" : "font-normal"
                }`}
                role="option"
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.color && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  <span className="truncate">{option.label}</span>
                </span>
                {selected && (
                  <CheckCircle2Icon
                    className="size-3.5 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function memberIdFromName(name: string) {
  return HOUSEHOLD_MEMBERS.find(
    (member) => member.name.toLowerCase() === name.toLowerCase()
  )?.id
}

function buildConvexMemberMaps(users: any[]) {
  const memberIdByConvexId = new Map<string, MemberId>()
  const convexIdByMemberId = new Map<MemberId, string>()

  for (const user of users) {
    const memberId = memberIdFromName(user.name)

    if (memberId) {
      memberIdByConvexId.set(user._id, memberId)
      convexIdByMemberId.set(memberId, user._id)
    }
  }

  return {
    convexIdByMemberId,
    memberIdByConvexId,
  }
}

function ConvexCalendarBridge({
  setConvexActions,
  setTasks,
}: {
  setConvexActions: Dispatch<SetStateAction<ConvexActions | undefined>>
  setTasks: Dispatch<SetStateAction<HouseholdTask[]>>
}) {
  const aggregate = useQuery(householdApi.listAggregateTasks, {})
  const seedDemoHousehold = useMutation(householdApi.seedDemoHousehold)
  const createTaskMutation = useMutation(householdApi.createTask)
  const updateTaskMutation = useMutation(householdApi.updateTask)
  const toggleTaskDoneMutation = useMutation(householdApi.toggleTaskDone)
  const notifyMissedTaskMutation = useMutation(householdApi.notifyMissedTask)
  const removeTaskMutation = useMutation(householdApi.removeTask)

  useEffect(() => {
    if (aggregate && aggregate.users.length === 0) {
      void seedDemoHousehold({}).catch(() => {
        toast.error("Convex demo seed failed.")
      })
    }
  }, [aggregate, seedDemoHousehold])

  useEffect(() => {
    if (!aggregate || aggregate.users.length === 0) {
      return
    }

    const { memberIdByConvexId } = buildConvexMemberMaps(aggregate.users)
    const mappedTasks = aggregate.tasks
      .map((task: any) => {
        const assignedTo = memberIdByConvexId.get(task.assignedTo)
        const createdBy = memberIdByConvexId.get(task.createdBy)

        if (!assignedTo || !createdBy) {
          return undefined
        }

        return {
          id: task._id,
          title: task.title,
          assignedTo,
          category: task.category === "spiritual" ? "chores" : task.category,
          startTime: new Date(task.startTime).toISOString(),
          endTime: new Date(task.endTime).toISOString(),
          status: task.status,
          communal: task.communal,
          resetCadence: task.resetCadence,
          createdBy,
          externalUrl: task.externalUrl,
          notes: task.notes,
          reminder: normalizeTask({
            id: task._id,
            title: task.title,
            assignedTo,
            category: task.category,
            startTime: new Date(task.startTime).toISOString(),
            endTime: new Date(task.endTime).toISOString(),
            status: task.status,
            communal: task.communal,
            resetCadence: task.resetCadence,
            createdBy,
            reminder: task.reminder ?? defaultTaskReminder(),
          }).reminder,
          completedAt:
            task.completedAt === undefined
              ? undefined
              : new Date(task.completedAt).toISOString(),
        } satisfies HouseholdTask
      })
      .filter((task: HouseholdTask | undefined): task is HouseholdTask =>
        Boolean(task)
      )

    setTasks(mappedTasks)
  }, [aggregate, setTasks])

  useEffect(() => {
    if (!aggregate || aggregate.users.length === 0) {
      return
    }

    const { convexIdByMemberId } = buildConvexMemberMaps(aggregate.users)
    const requireUserId = (memberId: MemberId) => {
      const userId = convexIdByMemberId.get(memberId)

      if (!userId) {
        throw new Error(`Missing Convex user for ${memberId}`)
      }

      return userId
    }

    setConvexActions({
      createTask: async (task) => {
        await createTaskMutation({
          title: task.title,
          assignedTo: requireUserId(task.assignedTo),
          category: task.category,
          startTime: new Date(task.startTime).getTime(),
          endTime: new Date(task.endTime).getTime(),
          communal: task.communal,
          resetCadence: task.resetCadence,
          createdBy: requireUserId(task.createdBy),
          externalUrl: task.externalUrl,
          notes: task.notes,
          reminder: task.reminder,
        })
      },
      removeTask: async (taskId) => {
        await removeTaskMutation({ taskId })
      },
      notifyMissedTask: async (taskId) => {
        await notifyMissedTaskMutation({ taskId })
      },
      toggleTaskDone: async (taskId, status) => {
        await toggleTaskDoneMutation({ taskId, status })
      },
      updateTask: async (task) => {
        await updateTaskMutation({
          taskId: task.id,
          title: task.title,
          assignedTo: requireUserId(task.assignedTo),
          category: task.category,
          startTime: new Date(task.startTime).getTime(),
          endTime: new Date(task.endTime).getTime(),
          communal: task.communal,
          resetCadence: task.resetCadence,
          externalUrl: task.externalUrl ?? null,
          notes: task.notes ?? null,
          reminder: task.reminder,
        })
      },
    })

    return () => setConvexActions(undefined)
  }, [
    aggregate,
    createTaskMutation,
    notifyMissedTaskMutation,
    removeTaskMutation,
    setConvexActions,
    toggleTaskDoneMutation,
    updateTaskMutation,
  ])

  return null
}

function CalendarEvent({
  categories,
  missed,
  task,
  onEdit,
  onToggleDone,
}: {
  categories: TaskCategory[]
  missed: boolean
  task: HouseholdTask
  onEdit: (task: HouseholdTask) => void
  onToggleDone: (task: HouseholdTask) => void
}) {
  const member = getMember(task.assignedTo)
  const category = resolveCategory(categories, task.category)
  const done = task.status === "Done"

  return (
    <div
      className={`group/event grid min-w-0 grid-cols-[1fr_auto] items-start gap-1 rounded-md border-l-4 bg-background/85 px-2 py-1.5 text-left shadow-sm ${
        missed ? "ring-1 ring-red-600/35" : ""
      }`}
      style={taskAccentStyle(task, categories, missed)}
      title={task.notes || undefined}
    >
      <button
        className="min-w-0 text-left"
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onEdit(task)
        }}
      >
        <span
          className={`block min-w-0 overflow-hidden text-xs font-medium leading-4 [display:-webkit-box] [overflow-wrap:anywhere] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] ${
            done
              ? "text-muted-foreground line-through"
              : missed
                ? "text-red-950 dark:text-red-100"
                : ""
          }`}
        >
          {task.title}
        </span>
        <span
          className={`mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-none ${
            missed ? "text-red-800 dark:text-red-200" : "text-muted-foreground"
          }`}
        >
          <span>{formatTime(task.startTime)}</span>
          <span>{member?.name}</span>
          <span>{category?.shortLabel}</span>
          {missed && (
            <span className="inline-flex items-center gap-0.5 font-semibold">
              <XIcon className="size-3" aria-hidden="true" />
              Missed
            </span>
          )}
          {task.reminder?.enabled && (
            <span className="truncate">
              {formatReminderSchedule(task.reminder.timings)}
            </span>
          )}
        </span>
      </button>
      <button
        aria-label={done ? "Reopen item" : "Mark item done"}
        className={`mt-0.5 flex size-5 items-center justify-center rounded-sm border bg-background transition ${
          done
            ? "border-emerald-600 text-emerald-600"
            : missed
              ? "border-red-600 text-red-600"
            : "text-muted-foreground opacity-70 group-hover/event:opacity-100"
        }`}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleDone(task)
        }}
      >
        {missed ? (
          <XIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}

function ContextMenu({
  categories,
  menu,
  onClose,
  onCreate,
}: {
  categories: TaskCategory[]
  menu: ContextMenuState
  onClose: () => void
  onCreate: (date: Date, category?: CategoryId) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }

    window.addEventListener("pointerdown", closeOnPointer)
    return () => window.removeEventListener("pointerdown", closeOnPointer)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      data-context-menu
      className="fixed z-50 w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
        type="button"
        onClick={() => {
          onCreate(menu.date)
          onClose()
        }}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
        New item
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
          type="button"
          onClick={() => {
            onCreate(menu.date, category.id)
            onClose()
          }}
        >
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: category.color }}
          />
          {category.shortLabel}
        </button>
      ))}
    </div>
  )
}

function TaskComposer({
  categories,
  categoryReminderPresets,
  date,
  draft,
  editingTask,
  onClose,
  onDraftChange,
  onRemove,
  onSubmit,
}: {
  categories: TaskCategory[]
  categoryReminderPresets: CategoryReminderPreset[]
  date: Date
  draft: TaskDraft
  editingTask: HouseholdTask | undefined
  onClose: () => void
  onDraftChange: (draft: TaskDraft) => void
  onRemove: (task: HouseholdTask) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/15 p-3 backdrop-blur-[2px] sm:place-items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className="grid max-h-[calc(100svh-1.5rem)] w-full max-w-5xl gap-4 overflow-auto rounded-lg border bg-popover p-5 text-popover-foreground shadow-2xl lg:grid-cols-2"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4 lg:col-span-2">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {formatFullDate(date)}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              {editingTask ? "Edit Item" : "New Item"}
            </h2>
          </div>
          <Button
            aria-label="Close composer"
            size="icon"
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <label className="grid gap-1 text-sm font-medium lg:col-span-2">
          Title
          <Input
            autoFocus
            className="h-11"
            placeholder="College list review"
            value={draft.title}
            onChange={(event) =>
              onDraftChange({ ...draft, title: event.currentTarget.value })
            }
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Assigned To
            <CalendarSelect<MemberId>
              ariaLabel="Assigned To"
              options={HOUSEHOLD_MEMBERS.map((member) => ({
                label: member.name,
                value: member.id,
              }))}
              value={draft.assignedTo}
              onChange={(assignedTo) =>
                onDraftChange({
                  ...draft,
                  assignedTo,
                })
              }
            />
          </label>

          <label className="grid gap-1 text-sm font-medium">
            Category
            <CalendarSelect<CategoryId>
              ariaLabel="Category"
              options={categories.map((category) => ({
                color: category.color,
                label: category.label,
                value: category.id,
              }))}
              value={draft.category}
              onChange={(category) =>
                onDraftChange({
                  ...draft,
                  category,
                  reminder: reminderFromPreset(
                    categoryReminderPresets.find(
                      (preset) => preset.categoryId === category
                    )
                  ),
                })
              }
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Start
            <Input
              className="h-11"
              type="datetime-local"
              value={draft.startTime}
              onChange={(event) =>
                onDraftChange({ ...draft, startTime: event.currentTarget.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            End
            <Input
              className="h-11"
              type="datetime-local"
              value={draft.endTime}
              onChange={(event) =>
                onDraftChange({ ...draft, endTime: event.currentTarget.value })
              }
            />
          </label>
        </div>

        <label className="grid gap-1 text-sm font-medium">
          External Link
          <Input
            className="h-11"
            placeholder="https://meet.google.com/"
            type="url"
            value={draft.externalUrl}
            onChange={(event) =>
              onDraftChange({ ...draft, externalUrl: event.currentTarget.value })
            }
          />
        </label>

        <label className="grid gap-1 text-sm font-medium">
          Notes
          <textarea
            className="min-h-24 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            placeholder="Add context, instructions, or links for this item"
            value={draft.notes}
            onChange={(event) =>
              onDraftChange({ ...draft, notes: event.currentTarget.value })
            }
          />
        </label>

        <section className="grid gap-3 rounded-lg border bg-background p-3 lg:row-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Reminder</h3>
              <p className="text-xs text-muted-foreground">
                Set timing and channels for this item.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                checked={draft.reminder.enabled}
                className="size-4"
                type="checkbox"
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    reminder: {
                      ...draft.reminder,
                      enabled: event.currentTarget.checked,
                    },
                  })
                }
              />
              Enabled
            </label>
          </div>

          <div className={draft.reminder.enabled ? "grid gap-3" : "grid gap-3 opacity-55"}>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Reminder timing</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {REMINDER_OPTIONS.map((option) => {
                  const selected = draft.reminder.timings.includes(
                    option.value as ReminderTiming
                  )

                  return (
                    <label
                      key={option.value}
                      className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
                    >
                      <input
                        checked={selected}
                        className="size-4"
                        disabled={!draft.reminder.enabled}
                        type="checkbox"
                        onChange={(event) => {
                          const timing = option.value as ReminderTiming
                          const timings = event.currentTarget.checked
                            ? [...draft.reminder.timings, timing]
                            : draft.reminder.timings.filter(
                                (current) => current !== timing
                              )

                          onDraftChange({
                            ...draft,
                            reminder: { ...draft.reminder, timings },
                          })
                        }}
                      />
                      {option.label}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                <input
                  checked={draft.reminder.email}
                  className="size-4"
                  disabled={!draft.reminder.enabled}
                  type="checkbox"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      reminder: {
                        ...draft.reminder,
                        email: event.currentTarget.checked,
                      },
                    })
                  }
                />
                Email
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                <input
                  checked={draft.reminder.sms}
                  className="size-4"
                  disabled={!draft.reminder.enabled}
                  type="checkbox"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      reminder: {
                        ...draft.reminder,
                        sms: event.currentTarget.checked,
                      },
                    })
                  }
                />
                Text message
              </label>
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
            <input
              checked={draft.communal}
              className="size-4"
              type="checkbox"
              onChange={(event) =>
                onDraftChange({ ...draft, communal: event.currentTarget.checked })
              }
            />
            Shared household item
          </label>

          <label className="grid gap-1 text-sm font-medium">
            Reset
            <CalendarSelect<ResetCadence>
              ariaLabel="Reset"
              options={[
                { label: "No reset", value: "none" },
                { label: "Daily", value: "daily" },
                { label: "Weekly", value: "weekly" },
              ]}
              value={draft.resetCadence}
              onChange={(resetCadence) =>
                onDraftChange({
                  ...draft,
                  resetCadence,
                })
              }
            />
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between lg:col-span-2">
          <div>
            {editingTask && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => onRemove(editingTask)}
              >
                <Trash2Icon className="size-4" aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!draft.title.trim()} type="submit">
              <PlusIcon className="size-4" aria-hidden="true" />
              {editingTask ? "Save" : "Add"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

export function NotesPanel({
  notes,
  onClose,
  onNotesChange,
}: {
  notes: NotePage[]
  onClose: () => void
  onNotesChange: (notes: NotePage[]) => void
}) {
  const [activeNoteId, setActiveNoteId] = useState(notes[0]?.id)
  const activeNote =
    notes.find((note) => note.id === activeNoteId) ?? notes[0]

  useEffect(() => {
    if (!activeNoteId && notes[0]) {
      setActiveNoteId(notes[0].id)
    }
  }, [activeNoteId, notes])

  function addNote() {
    const note: NotePage = {
      id: createNotePageId(),
      title: "Untitled Note",
      body: "",
      updatedAt: new Date().toISOString(),
    }

    onNotesChange([note, ...notes])
    setActiveNoteId(note.id)
  }

  function updateNote(patch: Partial<NotePage>) {
    if (!activeNote) {
      return
    }

    onNotesChange(
      notes.map((note) =>
        note.id === activeNote.id
          ? {
              ...note,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : note
      )
    )
  }

  function removeNote(noteId: string) {
    const nextNotes = notes.filter((note) => note.id !== noteId)

    onNotesChange(nextNotes)
    setActiveNoteId(nextNotes[0]?.id)
  }

  return (
    <div className="fixed inset-0 z-50 bg-background text-foreground">
      <div className="flex h-full flex-col">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-3">
            <BookOpenIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-normal">
                Notes
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                Shared household notes and links
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={addNote}>
              <PlusIcon className="size-4" aria-hidden="true" />
              New
            </Button>
            <Button aria-label="Close notes" size="icon" variant="ghost" onClick={onClose}>
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]">
          <aside className="min-h-0 overflow-auto border-b p-3 md:border-r md:border-b-0">
            <div className="grid gap-2">
              {notes.map((note) => (
                <button
                  key={note.id}
                  className={`rounded-lg border p-3 text-left hover:bg-muted ${
                    activeNote?.id === note.id ? "bg-muted" : "bg-card"
                  }`}
                  type="button"
                  onClick={() => setActiveNoteId(note.id)}
                >
                  <span className="block truncate text-sm font-medium">
                    {note.title || "Untitled Note"}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {note.body || "No notes yet"}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-h-0 overflow-auto p-4">
            {activeNote ? (
              <div className="mx-auto grid max-w-4xl gap-3">
                <Input
                  className="h-12 text-xl font-semibold"
                  value={activeNote.title}
                  onChange={(event) =>
                    updateNote({ title: event.currentTarget.value })
                  }
                />
                <textarea
                  className="min-h-[calc(100svh-12rem)] w-full resize-none rounded-lg border border-input bg-background p-3 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  placeholder="Write notes here..."
                  value={activeNote.body}
                  onChange={(event) =>
                    updateNote({ body: event.currentTarget.value })
                  }
                />
                <div className="flex justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Updated {formatFullDate(activeNote.updatedAt)}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => removeNote(activeNote.id)}
                  >
                    <Trash2Icon className="size-4" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-full place-items-center">
                <Button onClick={addNote}>
                  <PlusIcon className="size-4" aria-hidden="true" />
                  Create Note
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SettingsPanel({
  categories,
  categoryReminderPresets,
  onChangePassword,
  onCategoryReminderPresetsChange,
  onClose,
  onReminderProfileChange,
  reminderProfile,
  viewer,
}: {
  categories: TaskCategory[]
  categoryReminderPresets: CategoryReminderPreset[]
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>
  onCategoryReminderPresetsChange: (
    presets: CategoryReminderPreset[]
  ) => void
  onClose: () => void
  onReminderProfileChange: (profile: MemberReminderProfile) => void
  reminderProfile: MemberReminderProfile
  viewer: MemberId
}) {
  const [selectedReminderCategoryId, setSelectedReminderCategoryId] =
    useState<CategoryId>("classes")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  function updateReminderProfile(patch: Partial<MemberReminderProfile>) {
    onReminderProfileChange({ ...reminderProfile, ...patch })
  }

  function updateCategoryReminderPreset(
    categoryId: CategoryId,
    timing: ReminderTiming,
    enabled: boolean
  ) {
    const current =
      categoryReminderPresets.find(
        (preset) => preset.categoryId === categoryId
      )?.timings ?? []
    const timings = enabled
      ? [...current, timing]
      : current.filter((currentTiming) => currentTiming !== timing)
    const remaining = categoryReminderPresets.filter(
      (preset) => preset.categoryId !== categoryId
    )

    onCategoryReminderPresetsChange(
      timings.length > 0
        ? [...remaining, { categoryId, timings }]
        : remaining
    )
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentPassword || !newPassword) {
      toast.error("Enter your current and new password.")
      return
    }

    setIsChangingPassword(true)
    try {
      await onChangePassword(currentPassword, newPassword)
      setCurrentPassword("")
      setNewPassword("")
      toast.success("Password updated.")
    } catch {
      toast.error("Could not change your password. Check your current password.")
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/15 p-3 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="grid max-h-[calc(100svh-1.5rem)] w-full max-w-5xl gap-4 overflow-y-auto rounded-lg border bg-popover p-5 text-popover-foreground shadow-2xl lg:overflow-visible">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <SettingsIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-normal">
                Settings
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                Your contacts, password, and reminder defaults
              </p>
            </div>
          </div>
          <Button aria-label="Close settings" size="icon" variant="ghost" onClick={onClose}>
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid gap-3 rounded-lg border bg-background p-4">
            <div>
              <h3 className="text-sm font-semibold">Your Reminder Delivery</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Only your contact details are visible and editable here.
              </p>
            </div>

            <div className="grid gap-3 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-3">
              <span
                className="flex size-9 items-center justify-center rounded-lg border text-sm font-semibold"
                style={{ borderColor: getMember(viewer)?.color, color: getMember(viewer)?.color }}
              >
                {getMember(viewer)?.avatarIcon}
              </span>
              <div>
                <p className="text-sm font-semibold">{getMember(viewer)?.name}</p>
                <p className="text-xs text-muted-foreground">Your reminder delivery</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Email
                <Input
                  className="h-10"
                  placeholder="name@example.com"
                  type="email"
                  value={reminderProfile.email}
                  onChange={(event) =>
                    updateReminderProfile({ email: event.currentTarget.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Phone
                <Input
                  className="h-10"
                  placeholder="+1 555 555 5555"
                  type="tel"
                  value={reminderProfile.phone}
                  onChange={(event) =>
                    updateReminderProfile({ phone: event.currentTarget.value })
                  }
                />
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                <input
                  checked={reminderProfile.emailEnabled}
                  className="size-4"
                  type="checkbox"
                  onChange={(event) =>
                    updateReminderProfile({ emailEnabled: event.currentTarget.checked })
                  }
                />
                Email reminders
              </label>
              <label className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                <input
                  checked={reminderProfile.smsEnabled}
                  className="size-4"
                  type="checkbox"
                  onChange={(event) =>
                    updateReminderProfile({ smsEnabled: event.currentTarget.checked })
                  }
                />
                Text reminders
              </label>
            </div>
            </div>

            <form className="grid gap-3 rounded-lg border bg-card p-3" onSubmit={submitPasswordChange}>
              <div>
                <h3 className="text-sm font-semibold">Change Password</h3>
                <p className="mt-1 text-xs text-muted-foreground">Use at least eight characters.</p>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                Current password
                <Input
                  className="h-10"
                  disabled={isChangingPassword}
                  onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                  type="password"
                  value={currentPassword}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                New password
                <Input
                  className="h-10"
                  disabled={isChangingPassword}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  type="password"
                  value={newPassword}
                />
              </label>
              <Button disabled={isChangingPassword} type="submit">Update password</Button>
            </form>
          </section>

          <section className="grid content-start gap-3 rounded-lg border bg-background p-4">
          <div>
            <h3 className="text-sm font-semibold">Category Reminder Defaults</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              These timings are applied when you choose a category for a new item.
            </p>
          </div>
          {(() => {
            const selectedCategory =
              categories.find(
                (category) => category.id === selectedReminderCategoryId
              ) ?? categories[0]
            const timings =
              categoryReminderPresets.find(
                (preset) => preset.categoryId === selectedCategory.id
              )?.timings ?? []

            return (
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm font-medium">
                  Category
                  <CalendarSelect<CategoryId>
                    ariaLabel="Reminder category"
                    options={categories.map((category) => ({
                      color: category.color,
                      label: category.label,
                      value: category.id,
                    }))}
                    value={selectedCategory.id}
                    onChange={setSelectedReminderCategoryId}
                  />
                </label>
                <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2">
                  {REMINDER_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
                    >
                      <input
                        checked={timings.includes(option.value as ReminderTiming)}
                        className="size-4"
                        type="checkbox"
                        onChange={(event) =>
                          updateCategoryReminderPreset(
                            selectedCategory.id,
                            option.value as ReminderTiming,
                            event.currentTarget.checked
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
            )
          })()}
          </section>
        </div>
      </section>
    </div>
  )
}

function CategoryManagerPanel({
  categories,
  onCategoriesChange,
  onClose,
}: {
  categories: TaskCategory[]
  onCategoriesChange: (categories: TaskCategory[]) => void
  onClose: () => void
}) {
  const [categoryName, setCategoryName] = useState("")
  const [categoryColor, setCategoryColor] = useState("#64748b")
  const defaultCategoryIds = new Set(TASK_CATEGORIES.map((category) => category.id))

  function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = categoryName.trim()
    const id = createCategoryId(label)

    if (!label || !id) {
      toast.error("Category name is required.")
      return
    }

    if (categories.some((category) => category.id === id)) {
      toast.error("That category already exists.")
      return
    }

    onCategoriesChange([
      ...categories,
      {
        id,
        label,
        shortLabel: label.slice(0, 10),
        color: categoryColor,
        softColor: softColorFromHex(categoryColor),
      },
    ])
    setCategoryName("")
    setCategoryColor("#64748b")
    toast.success("Category added.")
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/15 p-3 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="grid max-h-[calc(100svh-1.5rem)] w-full max-w-2xl gap-4 overflow-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <TagsIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold">Categories</h2>
              <p className="text-sm text-muted-foreground">Add colors and organize calendar items.</p>
            </div>
          </div>
          <Button aria-label="Close categories" size="icon" variant="ghost" onClick={onClose}>
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <form className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={addCategory}>
          <label className="grid gap-1 text-sm font-medium">
            Category name
            <Input
              className="h-11"
              placeholder="Pets"
              value={categoryName}
              onChange={(event) => setCategoryName(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Color
            <Input
              className="h-11 w-20 p-1"
              type="color"
              value={categoryColor}
              onChange={(event) => setCategoryColor(event.currentTarget.value)}
            />
          </label>
          <div className="flex items-end">
            <Button disabled={!categoryName.trim()} type="submit">
              <PlusIcon className="size-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        </form>

        <div className="grid gap-2">
          {categories.map((category) => {
            const isDefault = defaultCategoryIds.has(category.id)

            return (
              <div key={category.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="size-4 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{category.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {isDefault ? "Default" : "Custom"}
                    </p>
                  </div>
                </div>
                {!isDefault && (
                  <Button
                    aria-label={`Remove ${category.label}`}
                    size="icon"
                    type="button"
                    variant="destructive"
                    onClick={() => onCategoriesChange(categories.filter((item) => item.id !== category.id))}
                  >
                    <Trash2Icon className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function LoadingScreen() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
      <div className="grid w-full max-w-sm justify-items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-foreground text-background">
          <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Universal Household Planner</h1>
          <p className="mt-1 text-sm text-muted-foreground">Checking secure access...</p>
        </div>
      </div>
    </main>
  )
}

function SignInScreen() {
  const { signIn } = useAuthActions()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [setupCode, setSetupCode] = useState("")
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!username.trim() || !password) {
      toast.error("Enter both your username and password.")
      return
    }

    if (isSettingUp && !setupCode) {
      toast.error("Enter the household setup code.")
      return
    }

    if (isSettingUp && (!contactEmail.trim() || !contactPhone.trim())) {
      toast.error("Enter an email address and phone number for reminders.")
      return
    }

    setIsSubmitting(true)

    try {
      if (isSettingUp) {
        window.sessionStorage.setItem(
          PENDING_CONTACT_PROFILE_KEY,
          JSON.stringify({
            email: contactEmail.trim(),
            phone: contactPhone.trim(),
          })
        )
      }

      await signIn("password", {
        flow: isSettingUp ? "signUp" : "signIn",
        username: username.trim(),
        password,
        ...(isSettingUp ? { setupCode } : {}),
      })
    } catch {
      window.sessionStorage.removeItem(PENDING_CONTACT_PROFILE_KEY)
      toast.error(
        isSettingUp
          ? "Could not create the account. Check the setup code and details."
          : "Could not sign in. Check your username and password."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground">
      <form
        className="grid w-full max-w-sm gap-5 rounded-lg border bg-card p-5 shadow-sm"
        onSubmit={submit}
      >
        <div className="grid gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-foreground text-background">
            <LockKeyholeIcon className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Household sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to open the shared calendar.
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            Username
            <Input
              autoComplete="username"
              className="h-10"
              disabled={isSubmitting}
              onChange={(event) => setUsername(event.currentTarget.value)}
              value={username}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Password
            <Input
              autoComplete={isSettingUp ? "new-password" : "current-password"}
              className="h-10"
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              value={password}
            />
          </label>
          {isSettingUp && (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                Email for reminders
                <Input
                  autoComplete="email"
                  className="h-10"
                  disabled={isSubmitting}
                  onChange={(event) => setContactEmail(event.currentTarget.value)}
                  type="email"
                  value={contactEmail}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Phone for reminders
                <Input
                  autoComplete="tel"
                  className="h-10"
                  disabled={isSubmitting}
                  onChange={(event) => setContactPhone(event.currentTarget.value)}
                  type="tel"
                  value={contactPhone}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Household setup code
                <Input
                  autoComplete="one-time-code"
                  className="h-10"
                  disabled={isSubmitting}
                  onChange={(event) => setSetupCode(event.currentTarget.value)}
                  type="password"
                  value={setupCode}
                />
              </label>
            </>
          )}
        </div>

        <Button className="h-10" disabled={isSubmitting} type="submit">
          {isSubmitting ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogInIcon className="size-4" aria-hidden="true" />
          )}
          {isSettingUp ? "Create household account" : "Sign in"}
        </Button>

        <button
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          disabled={isSubmitting}
          onClick={() => setIsSettingUp((current) => !current)}
          type="button"
        >
          {isSettingUp ? "I already have an account" : "Set up an approved account"}
        </button>
      </form>
    </main>
  )
}

function SecureCalendarGate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { signOut } = useAuthActions()
  const viewer = useQuery(
    householdApi.getCurrentViewer,
    isAuthenticated ? {} : "skip"
  )

  async function handleSignOut() {
    await signOut()
    toast.success("Signed out.")
  }

  if (isLoading || (isAuthenticated && viewer === undefined)) {
    return <LoadingScreen />
  }

  const viewerId = HOUSEHOLD_MEMBERS.find(
    (member) => member.id === viewer?.username
  )?.id

  return isAuthenticated && viewerId ? (
    <CalendarHome onSignOut={handleSignOut} viewer={viewerId} />
  ) : (
    <SignInScreen />
  )
}

function BackendRequiredScreen() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
      <div className="grid w-full max-w-sm gap-3 rounded-lg border bg-card p-5 shadow-sm">
        <LockKeyholeIcon className="size-5" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Secure access needs configuration</h1>
        <p className="text-sm text-muted-foreground">
          Connect this deployment to Convex before opening the household calendar.
        </p>
      </div>
    </main>
  )
}

export function HomeRoute() {
  return convexEnabled ? <SecureCalendarGate /> : <BackendRequiredScreen />
}

function CalendarHome({
  onSignOut,
  viewer,
}: {
  onSignOut: () => Promise<void>
  viewer: MemberId
}) {
  const contactProfile = useQuery(householdApi.getMyContactProfile, {})
  const saveContactProfile = useMutation(householdApi.saveMyContactProfile)
  const changeMyPassword = useAction(householdApi.changeMyPassword)
  const [tasks, setTasks] = usePersistentState(
    STORAGE_KEYS.tasks,
    buildSeedTasks
  )
  const [categories, setCategories] = usePersistentState(
    STORAGE_KEYS.categories,
    () => TASK_CATEGORIES
  )
  const [notifications, setNotifications] = usePersistentState(
    STORAGE_KEYS.notifications,
    buildSeedNotifications
  )
  const [reminderProfile, setReminderProfile] = usePersistentState(
    `${STORAGE_KEYS.reminderProfiles}-${viewer}`,
    () =>
      buildSeedReminderProfiles().find((profile) => profile.memberId === viewer)!
  )
  const [categoryReminderPresets, setCategoryReminderPresets] = usePersistentState(
    `${STORAGE_KEYS.reminderCategoryPresets}-${viewer}`,
    buildSeedCategoryReminderPresets
  )
  const [viewDate, setViewDate] = useState(() => startOfDay(new Date()))
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [now, setNow] = useState(() => Date.now())
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [composerDate, setComposerDate] = useState<Date>()
  const [draft, setDraft] = useState(() => createDraftForDate(new Date()))
  const [editingTask, setEditingTask] = useState<HouseholdTask>()
  const [convexActions, setConvexActions] = useState<ConvexActions>()
  const [activePanel, setActivePanel] = useState<"settings" | "categories">()
  const reportedMissedTaskIds = useRef(new Set<string>())

  const calendarCategories = categories.length > 0 ? categories : TASK_CATEGORIES
  const monthCells = useMemo(() => buildMonthCells(viewDate), [viewDate])
  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks])
  const missedTasks = useMemo(
    () => sortedTasks.filter((task) => isTaskMissed(task, now)),
    [now, sortedTasks]
  )
  const missedTaskIds = useMemo(
    () => new Set(missedTasks.map((task) => task.id)),
    [missedTasks]
  )
  const activeMissedAlertCount = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          notification.kind === "missed" &&
          missedTasks.some((task) =>
            notification.id.startsWith(`missed-${task.id}-`)
          )
      ).length,
    [missedTasks, notifications]
  )
  const selectedDateTasks = useMemo(
    () => tasksForDate(tasks, selectedDate),
    [selectedDate, tasks]
  )
  const pendingCount = tasks.filter((task) => task.status === "Pending").length
  const doneCount = tasks.length - pendingCount
  const latestMissedTask = missedTasks[missedTasks.length - 1]

  useEffect(() => {
    if (!contactProfile) {
      return
    }

    const pending = window.sessionStorage.getItem(PENDING_CONTACT_PROFILE_KEY)

    if (pending) {
      try {
        const parsed = JSON.parse(pending) as { email?: string; phone?: string }
        const next = {
          memberId: viewer,
          email: parsed.email?.trim() ?? "",
          phone: parsed.phone?.trim() ?? "",
          emailEnabled: true,
          smsEnabled: true,
        }

        setReminderProfile(next)
        void saveContactProfile({
          email: next.email,
          phone: next.phone,
          emailEnabled: next.emailEnabled,
          smsEnabled: next.smsEnabled,
        })
          .then(() => window.sessionStorage.removeItem(PENDING_CONTACT_PROFILE_KEY))
          .catch(() => toast.error("Could not save your reminder contacts."))
        return
      } catch {
        window.sessionStorage.removeItem(PENDING_CONTACT_PROFILE_KEY)
      }
    }

    setReminderProfile({ memberId: viewer, ...contactProfile })
  }, [contactProfile, saveContactProfile, setReminderProfile, viewer])

  function updateReminderProfile(profile: MemberReminderProfile) {
    setReminderProfile(profile)
    void saveContactProfile({
      email: profile.email,
      phone: profile.phone,
      emailEnabled: profile.emailEnabled,
      smsEnabled: profile.smsEnabled,
    }).catch(() => {
      toast.error("Could not save your reminder contacts.")
    })
  }

  async function updatePassword(currentPassword: string, newPassword: string) {
    await changeMyPassword({
      username: viewer,
      currentPassword,
      newPassword,
    })
  }

  useEffect(() => {
    setCategories((current) =>
      current.filter((category) => category.id !== "spiritual")
    )
    setTasks((current) =>
      current.map((task) => normalizeTask(task))
    )
  }, [setCategories, setTasks])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setNotifications((current) => {
      const existingIds = new Set(current.map((notification) => notification.id))
      const additions = buildMissedNotifications(missedTasks, existingIds)

      if (additions.length === 0) {
        return current
      }

      return [...additions, ...current]
    })
  }, [missedTasks, setNotifications])

  useEffect(() => {
    if (!convexActions) {
      return
    }

    for (const task of missedTasks) {
      if (reportedMissedTaskIds.current.has(task.id)) {
        continue
      }

      reportedMissedTaskIds.current.add(task.id)
      void convexActions.notifyMissedTask(task.id).catch(() => {
        reportedMissedTaskIds.current.delete(task.id)
        toast.error("Convex could not send the missed-task alert.")
      })
    }
  }, [convexActions, missedTasks])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(undefined)
        setComposerDate(undefined)
      }
    }

    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [])

  function previousMonth() {
    setViewDate(
      (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1)
    )
  }

  function nextMonth() {
    setViewDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1)
    )
  }

  function goToday() {
    const today = startOfDay(new Date())
    setViewDate(today)
    setSelectedDate(today)
  }

  function openContextMenu(event: MouseEvent<HTMLElement>, date: Date) {
    event.preventDefault()
    event.stopPropagation()

    const selected = startOfDay(date)
    setSelectedDate(selected)
    setContextMenu({
      date: selected,
      x: Math.min(event.clientX, window.innerWidth - 240),
      y: Math.min(event.clientY, window.innerHeight - 280),
    })
  }

  function openComposer(date: Date, category?: CategoryId) {
    const selected = startOfDay(date)
    const selectedCategory = category ?? "chores"
    setSelectedDate(selected)
    setComposerDate(selected)
    setEditingTask(undefined)
    setDraft({
      ...createDraftForDate(selected, selectedCategory, viewer),
      reminder: reminderFromPreset(
        categoryReminderPresets.find(
          (preset) => preset.categoryId === selectedCategory
        )
      ),
    })
  }

  function openEditor(task: HouseholdTask) {
    const date = startOfDay(new Date(task.startTime))
    setSelectedDate(date)
    setComposerDate(date)
    setEditingTask(task)
    setDraft(draftFromTask(task))
  }

  function closeComposer() {
    setComposerDate(undefined)
    setEditingTask(undefined)
  }

  function buildTaskFromDraft(): HouseholdTask {
    return {
      id: editingTask?.id ?? createTaskId(),
      title: draft.title.trim(),
      assignedTo: draft.assignedTo,
      category: draft.category,
      startTime: fromDateTimeInputValue(draft.startTime),
      endTime: fromDateTimeInputValue(draft.endTime),
      status: editingTask?.status ?? "Pending",
      communal: draft.communal,
      resetCadence: draft.resetCadence,
      createdBy: editingTask?.createdBy ?? "neelam",
      externalUrl: draft.externalUrl.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      completedAt: editingTask?.completedAt,
      reminder: draft.reminder,
    }
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!draft.title.trim()) {
      toast.error("Task title is required.")
      return
    }

    const task = buildTaskFromDraft()

    setTasks((current) => {
      if (editingTask) {
        return current.map((item) => (item.id === editingTask.id ? task : item))
      }

      return [...current, task]
    })

    const persistence = editingTask
      ? convexActions?.updateTask(task)
      : convexActions?.createTask(task)

    void persistence?.catch(() => {
      toast.error("Convex could not save that item.")
    })

    toast.success(editingTask ? "Item updated." : "Item added.")
    closeComposer()
  }

  function removeTask(task: HouseholdTask) {
    setTasks((current) => current.filter((item) => item.id !== task.id))
    void convexActions?.removeTask(task.id).catch(() => {
      toast.error("Convex could not remove that item.")
    })
    toast.success("Item removed.")
    closeComposer()
  }

  function toggleTaskDone(task: HouseholdTask) {
    const nextStatus = task.status === "Done" ? "Pending" : "Done"
    const completedAt =
      nextStatus === "Done" ? new Date().toISOString() : undefined

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              completedAt,
              status: nextStatus,
            }
          : item
      )
    )

    void convexActions?.toggleTaskDone(task.id, nextStatus).catch(() => {
      toast.error("Convex could not update that item.")
    })
  }

  return (
    <main
      className="flex min-h-svh flex-col bg-background text-foreground"
      onClick={() => setContextMenu(undefined)}
    >
      <ConvexCalendarBridge
        setConvexActions={setConvexActions}
        setTasks={setTasks}
      />

      <header className="border-b bg-background/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              <HomeIcon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-normal sm:text-lg">
                Universal Household Planner
              </h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                {convexActions ? "Live Sync" : "Local Calendar"} -{" "}
                {pendingCount} pending, {missedTasks.length} missed, {doneCount} done
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              aria-label="Previous month"
              size="icon"
              variant="outline"
              onClick={previousMonth}
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button className="hidden sm:inline-flex" variant="outline" onClick={goToday}>
              Today
            </Button>
            <Button
              aria-label="Next month"
              size="icon"
              variant="outline"
              onClick={nextMonth}
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button onClick={() => openComposer(selectedDate)}>
              <PlusIcon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">New</span>
            </Button>
            <Button variant="outline" onClick={() => setActivePanel("categories")}>
              <TagsIcon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Categories</span>
            </Button>
            <Button
              aria-label="Settings"
              size="icon"
              variant="outline"
              onClick={() => setActivePanel("settings")}
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button
              aria-label="Sign out"
              size="icon"
              variant="outline"
              onClick={() => void onSignOut()}
            >
              <LogOutIcon className="size-4" aria-hidden="true" />
            </Button>
            <ThemeMenu />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CalendarDaysIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-normal sm:text-3xl">
                {formatMonth(viewDate)}
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                Selected: {formatFullDate(selectedDate)} -{" "}
                {selectedDateTasks.length} item
                {selectedDateTasks.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => openComposer(selectedDate)}>
              <PlusIcon className="size-3.5" aria-hidden="true" />
              Add To Selected Day
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              {calendarCategories.map((category) => (
                <span
                  key={category.id}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium"
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  {category.shortLabel}
                </span>
              ))}
            </div>
          </div>
        </div>

        {missedTasks.length > 0 && (
          <div className="flex min-h-11 items-center gap-2 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-950 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-100">
            <XIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="shrink-0 font-semibold">
              {missedTasks.length} missed
            </span>
            <span className="min-w-0 truncate">
              {getMember(latestMissedTask?.assignedTo ?? "neelam")?.name ??
                "Someone"}{" "}
              did not complete {latestMissedTask?.title ?? "the task"}.{" "}
              {activeMissedAlertCount} household alert
              {activeMissedAlertCount === 1 ? "" : "s"} sent.
            </span>
          </div>
        )}
      </header>

      <section className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="grid h-full min-h-[760px] min-w-[900px] grid-rows-[auto_1fr] rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="grid grid-cols-7 border-b bg-muted/45">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="border-r px-3 py-2 text-xs font-semibold uppercase tracking-normal text-muted-foreground last:border-r-0"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 grid-rows-[repeat(6,minmax(0,1fr))]">
            {monthCells.map((day) => {
              const dayTasks = tasksForDate(sortedTasks, day)
              const hiddenCount = Math.max(dayTasks.length - 5, 0)
              const isOutsideMonth = !isSameMonth(day, viewDate)
              const isSelected = isSameDay(day, selectedDate)
              const isToday = isSameDay(day, new Date())

              return (
                <section
                  key={day.toISOString()}
                  className={`min-w-0 border-r border-b p-2 transition last:border-r-0 ${
                    isOutsideMonth ? "bg-muted/25 text-muted-foreground" : "bg-background"
                  } ${isSelected ? "ring-2 ring-inset ring-foreground" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedDate(startOfDay(day))
                  }}
                  onContextMenu={(event) => openContextMenu(event, day)}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      className={`flex size-8 items-center justify-center rounded-md text-sm font-semibold ${
                        isToday ? "bg-foreground text-background" : "hover:bg-muted"
                      }`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedDate(startOfDay(day))
                      }}
                    >
                      {day.getDate()}
                    </button>
                    {dayTasks.length > 0 && (
                      <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                        {dayTasks.length}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    {dayTasks.slice(0, 5).map((task) => (
                      <CalendarEvent
                        categories={calendarCategories}
                        key={task.id}
                        missed={missedTaskIds.has(task.id)}
                        task={task}
                        onEdit={openEditor}
                        onToggleDone={toggleTaskDone}
                      />
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        className="rounded-md border border-dashed px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedDate(startOfDay(day))
                        }}
                      >
                        +{hiddenCount} more
                      </button>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </section>

      {contextMenu && (
        <ContextMenu
          categories={calendarCategories}
          menu={contextMenu}
          onClose={() => setContextMenu(undefined)}
          onCreate={openComposer}
        />
      )}

      {composerDate && (
        <TaskComposer
          categories={calendarCategories}
          categoryReminderPresets={categoryReminderPresets}
          date={composerDate}
          draft={draft}
          editingTask={editingTask}
          onClose={closeComposer}
          onDraftChange={setDraft}
          onRemove={removeTask}
          onSubmit={submitTask}
        />
      )}

      {activePanel === "settings" && (
        <SettingsPanel
          categories={calendarCategories}
          categoryReminderPresets={categoryReminderPresets}
          onChangePassword={updatePassword}
          onCategoryReminderPresetsChange={setCategoryReminderPresets}
          onClose={() => setActivePanel(undefined)}
          onReminderProfileChange={updateReminderProfile}
          reminderProfile={reminderProfile}
          viewer={viewer}
        />
      )}

      {activePanel === "categories" && (
        <CategoryManagerPanel
          categories={calendarCategories}
          onCategoriesChange={setCategories}
          onClose={() => setActivePanel(undefined)}
        />
      )}
    </main>
  )
}
