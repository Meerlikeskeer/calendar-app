import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HomeIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useMutation, useQuery } from "convex/react"
import { makeFunctionReference } from "convex/server"
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
  buildSeedNotes,
  buildSeedNotifications,
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
  HouseholdTask,
  MemberId,
  MemberReminderProfile,
  ResetCadence,
  TaskStatus,
  NotePage,
  NotificationRecord,
  TaskCategory,
  TaskReminderSettings,
} from "@/lib/household-data"

const convexEnabled = Boolean(import.meta.env.VITE_CONVEX_URL)

const householdApi = {
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
  reminder: TaskReminderSettings
}

interface ContextMenuState {
  date: Date
  x: number
  y: number
}

const REMINDER_OPTIONS = [
  { label: "15 min before", value: "15" },
  { label: "30 min before", value: "30" },
  { label: "1 hr before", value: "60" },
  { label: "2 hr before", value: "120" },
  { label: "1 day before", value: "1440" },
  { label: "2 days before", value: "2880" },
] as const

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
    reminder: task.reminder ?? defaultTaskReminder(),
  }
}

function normalizeTask(task: HouseholdTask): HouseholdTask {
  return {
    ...task,
    category: task.category === "spiritual" ? "chores" : task.category,
    reminder: task.reminder ?? defaultTaskReminder(),
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

function formatReminderOffset(minutes: number) {
  if (minutes >= 1440) {
    const days = minutes / 1440
    return `${days} day${days === 1 ? "" : "s"} before`
  }

  if (minutes >= 60) {
    const hours = minutes / 60
    return `${hours} hr before`
  }

  return `${minutes} min before`
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
          reminder: task.reminder ?? defaultTaskReminder(),
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
            <span>{formatReminderOffset(task.reminder.offsetMinutes)}</span>
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
  date,
  draft,
  editingTask,
  onClose,
  onDraftChange,
  onRemove,
  onSubmit,
}: {
  categories: TaskCategory[]
  date: Date
  draft: TaskDraft
  editingTask: HouseholdTask | undefined
  onClose: () => void
  onDraftChange: (draft: TaskDraft) => void
  onRemove: (task: HouseholdTask) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/15 p-3 backdrop-blur-[2px] sm:place-items-center">
      <form
        className="grid max-h-[calc(100svh-1.5rem)] w-full max-w-xl gap-4 overflow-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-2xl"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4">
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

        <label className="grid gap-1 text-sm font-medium">
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

        <section className="grid gap-3 rounded-lg border bg-background p-3">
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
            <label className="grid gap-1 text-sm font-medium">
              Remind Me
              <CalendarSelect<string>
                ariaLabel="Reminder frequency"
                disabled={!draft.reminder.enabled}
                options={[...REMINDER_OPTIONS]}
                value={String(draft.reminder.offsetMinutes)}
                onChange={(offsetMinutes) =>
                  onDraftChange({
                    ...draft,
                    reminder: {
                      ...draft.reminder,
                      offsetMinutes: Number(offsetMinutes),
                    },
                  })
                }
              />
            </label>

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

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
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

function NotesPanel({
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
  onCategoriesChange,
  onClose,
  onReminderProfilesChange,
  reminderProfiles,
}: {
  categories: TaskCategory[]
  onCategoriesChange: (categories: TaskCategory[]) => void
  onClose: () => void
  onReminderProfilesChange: (profiles: MemberReminderProfile[]) => void
  reminderProfiles: MemberReminderProfile[]
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

  function removeCategory(categoryId: CategoryId) {
    if (defaultCategoryIds.has(categoryId)) {
      toast.error("Default categories stay available.")
      return
    }

    onCategoriesChange(categories.filter((category) => category.id !== categoryId))
  }

  function updateReminderProfile(
    memberId: MemberId,
    patch: Partial<MemberReminderProfile>
  ) {
    onReminderProfilesChange(
      reminderProfiles.map((profile) =>
        profile.memberId === memberId ? { ...profile, ...patch } : profile
      )
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/15 p-3 backdrop-blur-[2px]">
      <section className="grid max-h-[calc(100svh-1.5rem)] w-full max-w-2xl gap-4 overflow-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <SettingsIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-normal">
                Settings
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                Manage reminders and calendar categories
              </p>
            </div>
          </div>
          <Button aria-label="Close settings" size="icon" variant="ghost" onClick={onClose}>
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <section className="grid gap-3 rounded-lg border bg-background p-3">
          <div>
            <h3 className="text-sm font-semibold">Reminder Accounts</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Prototype credentials and contact routes for email/text reminders.
            </p>
          </div>

          <div className="grid gap-3">
            {HOUSEHOLD_MEMBERS.map((member) => {
              const profile =
                reminderProfiles.find((item) => item.memberId === member.id) ??
                {
                  memberId: member.id,
                  username: member.name.toLowerCase(),
                  password: "",
                  email: "",
                  phone: "",
                  emailEnabled: true,
                  smsEnabled: false,
                }

              return (
                <div
                  key={member.id}
                  className="grid gap-3 rounded-lg border bg-card p-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-9 items-center justify-center rounded-lg border text-sm font-semibold"
                      style={{ borderColor: member.color, color: member.color }}
                    >
                      {member.avatarIcon}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{member.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Reminder login and delivery
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-medium">
                      Username
                      <Input
                        className="h-10"
                        value={profile.username}
                        onChange={(event) =>
                          updateReminderProfile(member.id, {
                            username: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Password
                      <Input
                        className="h-10"
                        placeholder="Set password"
                        type="password"
                        value={profile.password}
                        onChange={(event) =>
                          updateReminderProfile(member.id, {
                            password: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Email
                      <Input
                        className="h-10"
                        placeholder="name@example.com"
                        type="email"
                        value={profile.email}
                        onChange={(event) =>
                          updateReminderProfile(member.id, {
                            email: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Phone
                      <Input
                        className="h-10"
                        placeholder="+1 555 555 5555"
                        type="tel"
                        value={profile.phone}
                        onChange={(event) =>
                          updateReminderProfile(member.id, {
                            phone: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                      <input
                        checked={profile.emailEnabled}
                        className="size-4"
                        type="checkbox"
                        onChange={(event) =>
                          updateReminderProfile(member.id, {
                            emailEnabled: event.currentTarget.checked,
                          })
                        }
                      />
                      Email reminders
                    </label>
                    <label className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                      <input
                        checked={profile.smsEnabled}
                        className="size-4"
                        type="checkbox"
                        onChange={(event) =>
                          updateReminderProfile(member.id, {
                            smsEnabled: event.currentTarget.checked,
                          })
                        }
                      />
                      Text reminders
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <form className="grid gap-3 rounded-lg border bg-background p-3" onSubmit={addCategory}>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="grid gap-1 text-sm font-medium">
              Category Name
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
          </div>
        </form>

        <div className="grid gap-2">
          {categories.map((category) => {
            const isDefault = defaultCategoryIds.has(category.id)

            return (
              <div
                key={category.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="size-4 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{category.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {isDefault ? "Default" : "Custom"} - {category.id}
                    </p>
                  </div>
                </div>
                {!isDefault && (
                  <Button
                    aria-label={`Remove ${category.label}`}
                    size="icon"
                    type="button"
                    variant="destructive"
                    onClick={() => removeCategory(category.id)}
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

export function HomeRoute() {
  const [tasks, setTasks] = usePersistentState(
    STORAGE_KEYS.tasks,
    buildSeedTasks
  )
  const [categories, setCategories] = usePersistentState(
    STORAGE_KEYS.categories,
    () => TASK_CATEGORIES
  )
  const [notes, setNotes] = usePersistentState(STORAGE_KEYS.notes, buildSeedNotes)
  const [notifications, setNotifications] = usePersistentState(
    STORAGE_KEYS.notifications,
    buildSeedNotifications
  )
  const [reminderProfiles, setReminderProfiles] = usePersistentState(
    STORAGE_KEYS.reminderProfiles,
    buildSeedReminderProfiles
  )
  const [viewDate, setViewDate] = useState(() => startOfDay(new Date()))
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [now, setNow] = useState(() => Date.now())
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [composerDate, setComposerDate] = useState<Date>()
  const [draft, setDraft] = useState(() => createDraftForDate(new Date()))
  const [editingTask, setEditingTask] = useState<HouseholdTask>()
  const [convexActions, setConvexActions] = useState<ConvexActions>()
  const [activePanel, setActivePanel] = useState<"notes" | "settings">()
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
    setCategories((current) =>
      current.filter((category) => category.id !== "spiritual")
    )
    setTasks((current) =>
      current.map((task) => normalizeTask(task))
    )
    setReminderProfiles((current) => {
      const currentByMember = new Map(
        current.map((profile) => [profile.memberId, profile])
      )

      return buildSeedReminderProfiles().map((profile) => ({
        ...profile,
        ...currentByMember.get(profile.memberId),
      }))
    })
  }, [setCategories, setReminderProfiles, setTasks])

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
    setSelectedDate(selected)
    setComposerDate(selected)
    setEditingTask(undefined)
    setDraft(createDraftForDate(selected, category))
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
      {convexEnabled && (
        <ConvexCalendarBridge
          setConvexActions={setConvexActions}
          setTasks={setTasks}
        />
      )}

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
            <Button variant="outline" onClick={() => setActivePanel("notes")}>
              <BookOpenIcon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Notes</span>
            </Button>
            <Button
              aria-label="Settings"
              size="icon"
              variant="outline"
              onClick={() => setActivePanel("settings")}
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
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
          date={composerDate}
          draft={draft}
          editingTask={editingTask}
          onClose={closeComposer}
          onDraftChange={setDraft}
          onRemove={removeTask}
          onSubmit={submitTask}
        />
      )}

      {activePanel === "notes" && (
        <NotesPanel
          notes={notes}
          onClose={() => setActivePanel(undefined)}
          onNotesChange={setNotes}
        />
      )}

      {activePanel === "settings" && (
        <SettingsPanel
          categories={calendarCategories}
          onCategoriesChange={setCategories}
          onClose={() => setActivePanel(undefined)}
          onReminderProfilesChange={setReminderProfiles}
          reminderProfiles={reminderProfiles}
        />
      )}
    </main>
  )
}
