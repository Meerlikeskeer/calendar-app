import { mutationGeneric as mutation, queryGeneric as query } from "convex/server"
import { ConvexError, v } from "convex/values"

const householdRole = v.union(
  v.literal("adult"),
  v.literal("student"),
  v.literal("child"),
)

const taskStatus = v.union(v.literal("Pending"), v.literal("Done"))

const resetCadence = v.union(
  v.literal("none"),
  v.literal("daily"),
  v.literal("weekly"),
)

const taskReminder = v.union(
  v.object({
    enabled: v.boolean(),
    offsetMinutes: v.number(),
    email: v.boolean(),
    sms: v.boolean(),
  }),
  v.object({
    enabled: v.boolean(),
    timings: v.array(v.string()),
    email: v.boolean(),
    sms: v.boolean(),
  }),
)

const homeControlStatus = v.union(
  v.literal("Locked"),
  v.literal("Ready"),
  v.literal("Active"),
  v.literal("Paused"),
)

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

function requireText(value: string, label: string) {
  const text = value.trim()

  if (!text) {
    fail("INVALID_INPUT", `${label} is required`)
  }

  return text
}

function optionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return undefined
  }

  const text = value.trim()

  return text ? text : undefined
}

function requireTimeRange(startTime: number, endTime: number) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    fail("INVALID_INPUT", "Task times must be valid timestamps")
  }

  if (endTime < startTime) {
    fail("INVALID_INPUT", "End time must be after start time")
  }
}

async function getAuthSubject(ctx: any) {
  try {
    const identity = await ctx.auth.getUserIdentity()
    return identity?.subject
  } catch {
    return undefined
  }
}

async function requireAuthenticated(ctx: any) {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    fail("UNAUTHENTICATED", "Sign in is required to access this household")
  }

  return identity
}

async function getUserOrThrow(ctx: any, userId: any) {
  const user = await ctx.db.get("householdUsers", userId)

  if (!user) {
    fail("NOT_FOUND", "Household user not found")
  }

  return user
}

async function getTaskOrThrow(ctx: any, taskId: any) {
  const task = await ctx.db.get("householdTasks", taskId)

  if (!task) {
    fail("NOT_FOUND", "Task not found")
  }

  return task
}

function sortUsers(users: any[]) {
  return users.sort((first, second) => {
    if (first.sortOrder !== second.sortOrder) {
      return first.sortOrder - second.sortOrder
    }

    return first.name.localeCompare(second.name)
  })
}

function sortTasks(tasks: any[]) {
  return tasks.sort((first, second) => first.startTime - second.startTime)
}

function enrichTasks(tasks: any[], users: any[]) {
  const usersById = new Map(users.map((user) => [user._id, user]))

  return sortTasks(tasks).map((task) => ({
    ...task,
    assignedUser: usersById.get(task.assignedTo) ?? null,
    createdByUser: usersById.get(task.createdBy) ?? null,
  }))
}

function buildStats(tasks: any[], users: any[]) {
  const done = tasks.filter((task) => task.status === "Done")
  const now = Date.now()
  const dueSoon = tasks.filter(
    (task) =>
      task.status === "Pending" &&
      task.startTime >= now &&
      task.startTime <= now + 60 * 60 * 1000,
  )

  return {
    total: tasks.length,
    pending: tasks.length - done.length,
    done: done.length,
    completionRate:
      tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100),
    dueSoon: dueSoon.length,
    communal: tasks.filter((task) => task.communal).length,
    byUser: users.map((user) => {
      const assigned = tasks.filter((task) => task.assignedTo === user._id)

      return {
        user,
        total: assigned.length,
        pending: assigned.filter((task) => task.status === "Pending").length,
        done: assigned.filter((task) => task.status === "Done").length,
      }
    }),
  }
}

async function logNotification(ctx: any, input: any) {
  const record: Record<string, unknown> = {
    kind: input.kind,
    title: input.title,
    body: input.body,
    isDemo: input.isDemo ?? false,
    createdAt: Date.now(),
  }

  if (input.memberId !== undefined) {
    record.memberId = input.memberId
  }

  if (input.taskId !== undefined) {
    record.taskId = input.taskId
  }

  await ctx.db.insert("notificationLog", record)
}

async function deleteDemoRows(ctx: any) {
  const tables = [
    "notificationLog",
    "householdTasks",
    "homeControls",
    "householdUsers",
  ]

  for (const table of tables) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_isDemo", (q: any) => q.eq("isDemo", true))
      .collect()

    for (const row of rows) {
      await ctx.db.delete(row._id)
    }
  }
}

function atDay(offsetDays: number, hour: number, minute = 0) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

export const listHouseholdUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticated(ctx)
    const users = await ctx.db.query("householdUsers").collect()

    return sortUsers(users)
  },
})

export const getCurrentViewer = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAuthenticated(ctx)
    const email = identity.email?.toLowerCase() ?? ""
    const username = email.endsWith("@household.local")
      ? email.slice(0, -"@household.local".length)
      : ""

    return { username }
  },
})

export const listAggregateTasks = query({
  args: {
    includeDone: v.optional(v.boolean()),
    assignedTo: v.optional(v.id("householdUsers")),
    category: v.optional(v.string()),
    communalOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const users = sortUsers(await ctx.db.query("householdUsers").collect())
    let tasks = await ctx.db.query("householdTasks").collect()

    if (args.includeDone === false) {
      tasks = tasks.filter((task) => task.status !== "Done")
    }

    if (args.assignedTo !== undefined) {
      tasks = tasks.filter((task) => task.assignedTo === args.assignedTo)
    }

    if (args.category !== undefined) {
      tasks = tasks.filter((task) => task.category === args.category)
    }

    if (args.communalOnly === true) {
      tasks = tasks.filter((task) => task.communal)
    }

    return {
      users,
      tasks: enrichTasks(tasks, users),
      stats: buildStats(tasks, users),
    }
  },
})

export const listTasksByUser = query({
  args: {
    userId: v.id("householdUsers"),
    includeDone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const users = sortUsers(await ctx.db.query("householdUsers").collect())
    let tasks = await ctx.db
      .query("householdTasks")
      .withIndex("by_assignedTo_status_startTime", (q: any) =>
        q.eq("assignedTo", args.userId),
      )
      .collect()

    if (args.includeDone === false) {
      tasks = tasks.filter((task) => task.status !== "Done")
    }

    return enrichTasks(tasks, users)
  },
})

export const listNotificationLog = query({
  args: {
    memberId: v.optional(v.id("householdUsers")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    let notifications = await ctx.db.query("notificationLog").collect()

    if (args.memberId !== undefined) {
      notifications = notifications.filter(
        (notification) => notification.memberId === args.memberId,
      )
    }

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200)

    return notifications
      .sort((first, second) => second.createdAt - first.createdAt)
      .slice(0, limit)
  },
})

export const listHomeControls = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticated(ctx)
    const controls = await ctx.db.query("homeControls").collect()

    return controls.sort((first, second) => first.label.localeCompare(second.label))
  },
})

export const createHouseholdUser = mutation({
  args: {
    name: v.string(),
    role: v.optional(householdRole),
    avatarIcon: v.optional(v.string()),
    color: v.optional(v.string()),
    pinHash: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const now = Date.now()
    const existingUsers = await ctx.db.query("householdUsers").collect()
    const authSubject = args.authSubject ?? (await getAuthSubject(ctx))
    const user: Record<string, unknown> = {
      name: requireText(args.name, "Name"),
      role: args.role ?? "adult",
      avatarIcon: args.avatarIcon?.trim() || requireText(args.name, "Name")[0],
      color: args.color?.trim() || "#3b82f6",
      sortOrder: args.sortOrder ?? existingUsers.length,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    }

    if (args.pinHash !== undefined) {
      user.pinHash = requireText(args.pinHash, "PIN hash")
    }

    if (authSubject !== undefined) {
      user.authSubject = authSubject
    }

    const userId = await ctx.db.insert("householdUsers", user)

    return await ctx.db.get(userId)
  },
})

export const createTask = mutation({
  args: {
    title: v.string(),
    assignedTo: v.id("householdUsers"),
    category: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    communal: v.optional(v.boolean()),
    resetCadence: v.optional(resetCadence),
    createdBy: v.id("householdUsers"),
    externalUrl: v.optional(v.string()),
    reminder: v.optional(taskReminder),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    requireTimeRange(args.startTime, args.endTime)
    await getUserOrThrow(ctx, args.assignedTo)
    await getUserOrThrow(ctx, args.createdBy)

    const now = Date.now()
    const task: Record<string, unknown> = {
      title: requireText(args.title, "Task title"),
      assignedTo: args.assignedTo,
      category: requireText(args.category, "Category"),
      startTime: args.startTime,
      endTime: args.endTime,
      status: "Pending",
      communal: args.communal ?? false,
      resetCadence: args.resetCadence ?? "none",
      createdBy: args.createdBy,
      reminder: args.reminder ?? {
        enabled: false,
        timings: [],
        email: true,
        sms: false,
      },
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    }
    const externalUrl = optionalText(args.externalUrl)

    if (externalUrl !== undefined) {
      task.externalUrl = externalUrl
    }

    const taskId = await ctx.db.insert("householdTasks", task)
    const createdTask = await ctx.db.get(taskId)

    await logNotification(ctx, {
      kind: "assignment",
      title: "New assignment",
      body: createdTask.title,
      memberId: args.assignedTo,
      taskId,
    })

    return createdTask
  },
})

export const updateTask = mutation({
  args: {
    taskId: v.id("householdTasks"),
    title: v.optional(v.string()),
    assignedTo: v.optional(v.id("householdUsers")),
    category: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    communal: v.optional(v.boolean()),
    resetCadence: v.optional(resetCadence),
    externalUrl: v.optional(v.union(v.string(), v.null())),
    reminder: v.optional(taskReminder),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const task = await getTaskOrThrow(ctx, args.taskId)
    const startTime = args.startTime ?? task.startTime
    const endTime = args.endTime ?? task.endTime
    requireTimeRange(startTime, endTime)

    const patch: Record<string, unknown> = {
      startTime,
      endTime,
      updatedAt: Date.now(),
    }

    if (args.title !== undefined) {
      patch.title = requireText(args.title, "Task title")
    }

    if (args.assignedTo !== undefined) {
      await getUserOrThrow(ctx, args.assignedTo)
      patch.assignedTo = args.assignedTo
    }

    if (args.category !== undefined) {
      patch.category = requireText(args.category, "Category")
    }

    if (args.communal !== undefined) {
      patch.communal = args.communal
    }

    if (args.resetCadence !== undefined) {
      patch.resetCadence = args.resetCadence
    }

    if (args.externalUrl !== undefined) {
      patch.externalUrl = optionalText(args.externalUrl)
    }

    if (args.reminder !== undefined) {
      patch.reminder = args.reminder
    }

    await ctx.db.patch(args.taskId, patch)
    const updatedTask = await ctx.db.get(args.taskId)

    await logNotification(ctx, {
      kind: "assignment",
      title: "Task updated",
      body: updatedTask.title,
      memberId: updatedTask.assignedTo,
      taskId: args.taskId,
      isDemo: updatedTask.isDemo,
    })

    return updatedTask
  },
})

export const assignTask = mutation({
  args: {
    taskId: v.id("householdTasks"),
    userId: v.id("householdUsers"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const task = await getTaskOrThrow(ctx, args.taskId)
    const user = await getUserOrThrow(ctx, args.userId)

    await ctx.db.patch(args.taskId, {
      assignedTo: args.userId,
      updatedAt: Date.now(),
    })

    const updatedTask = await ctx.db.get(args.taskId)

    await logNotification(ctx, {
      kind: "assignment",
      title: "Assignment alert",
      body: `${task.title} assigned to ${user.name}.`,
      memberId: args.userId,
      taskId: args.taskId,
      isDemo: task.isDemo,
    })

    return updatedTask
  },
})

export const toggleTaskDone = mutation({
  args: {
    taskId: v.id("householdTasks"),
    status: v.optional(taskStatus),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const task = await getTaskOrThrow(ctx, args.taskId)
    const status = args.status ?? (task.status === "Done" ? "Pending" : "Done")
    const patch: Record<string, unknown> = {
      status,
      updatedAt: Date.now(),
    }

    patch.completedAt = status === "Done" ? Date.now() : undefined

    await ctx.db.patch(args.taskId, patch)
    const updatedTask = await ctx.db.get(args.taskId)

    await logNotification(ctx, {
      kind: status === "Done" ? "due" : "assignment",
      title: status === "Done" ? "Task completed" : "Task reopened",
      body: task.title,
      memberId: task.assignedTo,
      taskId: args.taskId,
      isDemo: task.isDemo,
    })

    return updatedTask
  },
})

export const notifyMissedTask = mutation({
  args: {
    taskId: v.id("householdTasks"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const task = await getTaskOrThrow(ctx, args.taskId)
    const now = Date.now()

    if (task.status === "Done" || task.endTime >= now) {
      return {
        created: 0,
      }
    }

    const users = await ctx.db.query("householdUsers").collect()
    const assignedUser = users.find((user) => user._id === task.assignedTo)
    const existingNotifications = await ctx.db
      .query("notificationLog")
      .withIndex("by_task_createdAt", (q: any) => q.eq("taskId", args.taskId))
      .collect()
    const alreadyNotified = new Set(
      existingNotifications
        .filter((notification) => notification.kind === "missed")
        .map((notification) => notification.memberId),
    )
    let created = 0

    for (const user of users) {
      if (user._id === task.assignedTo || alreadyNotified.has(user._id)) {
        continue
      }

      await logNotification(ctx, {
        kind: "missed",
        title: "Missed task alert",
        body: `${assignedUser?.name ?? "Someone"} did not complete ${task.title}.`,
        memberId: user._id,
        taskId: args.taskId,
        isDemo: task.isDemo,
      })
      created += 1
    }

    return {
      created,
    }
  },
})

export const removeTask = mutation({
  args: {
    taskId: v.id("householdTasks"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const task = await getTaskOrThrow(ctx, args.taskId)

    await ctx.db.delete(args.taskId)
    await logNotification(ctx, {
      kind: "security",
      title: "Task removed",
      body: task.title,
      memberId: task.assignedTo,
      isDemo: task.isDemo,
    })

    return {
      removed: true,
      task,
    }
  },
})

export const sendMorningDigest = mutation({
  args: {
    memberId: v.id("householdUsers"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const member = await getUserOrThrow(ctx, args.memberId)
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const tasks = await ctx.db
      .query("householdTasks")
      .withIndex("by_assignedTo_status_startTime", (q: any) =>
        q.eq("assignedTo", args.memberId),
      )
      .collect()
    const todaysTasks = sortTasks(
      tasks.filter(
        (task) => task.startTime >= dayStart.getTime() && task.startTime < dayEnd.getTime(),
      ),
    )
    const body =
      todaysTasks.length === 0
        ? "No scheduled household tasks today."
        : todaysTasks.map((task) => task.title).join("; ")

    await logNotification(ctx, {
      kind: "digest",
      title: `${member.name} morning digest`,
      body,
      memberId: args.memberId,
    })

    return {
      member,
      taskCount: todaysTasks.length,
      body,
    }
  },
})

export const updateHomeControl = mutation({
  args: {
    controlId: v.id("homeControls"),
    status: homeControlStatus,
    value: v.optional(v.string()),
    updatedBy: v.optional(v.id("householdUsers")),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    const control = await ctx.db.get(args.controlId)

    if (!control) {
      fail("NOT_FOUND", "Home control not found")
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    }

    if (args.value !== undefined) {
      patch.value = requireText(args.value, "Control value")
    }

    if (args.updatedBy !== undefined) {
      await getUserOrThrow(ctx, args.updatedBy)
      patch.updatedBy = args.updatedBy
    }

    await ctx.db.patch(args.controlId, patch)
    const updatedControl = await ctx.db.get(args.controlId)

    await logNotification(ctx, {
      kind: "security",
      title: "Home control updated",
      body: `${updatedControl.label} is ${updatedControl.status}.`,
      memberId: args.updatedBy,
      isDemo: updatedControl.isDemo,
    })

    return updatedControl
  },
})

export const seedDemoHousehold = mutation({
  args: {
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx)
    if (args.reset === true) {
      await deleteDemoRows(ctx)
    }

    const existingDemoUsers = await ctx.db
      .query("householdUsers")
      .withIndex("by_isDemo", (q: any) => q.eq("isDemo", true))
      .collect()

    if (existingDemoUsers.length > 0) {
      const demoTasks = await ctx.db
        .query("householdTasks")
        .withIndex("by_isDemo", (q: any) => q.eq("isDemo", true))
        .collect()
      const demoControls = await ctx.db
        .query("homeControls")
        .withIndex("by_isDemo", (q: any) => q.eq("isDemo", true))
        .collect()

      return {
        seeded: false,
        users: sortUsers(existingDemoUsers),
        taskCount: demoTasks.length,
        homeControlCount: demoControls.length,
      }
    }

    const now = Date.now()
    const members = [
      {
        key: "neelam",
        name: "Neelam",
        role: "adult",
        avatarIcon: "N",
        color: "#f97316",
      },
      {
        key: "meer",
        name: "Meer",
        role: "student",
        avatarIcon: "M",
        color: "#14b8a6",
      },
      {
        key: "vaani",
        name: "Vaani",
        role: "student",
        avatarIcon: "V",
        color: "#ec4899",
      },
      {
        key: "haashi",
        name: "Haashi",
        role: "child",
        avatarIcon: "H",
        color: "#6366f1",
      },
    ]
    const userIds: Record<string, unknown> = {}

    for (const [sortOrder, member] of members.entries()) {
      const userId = await ctx.db.insert("householdUsers", {
        name: member.name,
        role: member.role,
        avatarIcon: member.avatarIcon,
        color: member.color,
        pinHash: "prototype-pin-1234",
        sortOrder,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })

      userIds[member.key] = userId
    }

    const taskSeeds = [
      {
        title: "Trash cans and recycling curb check",
        assignedTo: userIds.haashi,
        category: "chores",
        startTime: atDay(0, 7),
        endTime: atDay(0, 7, 30),
        status: "Done",
        communal: true,
        resetCadence: "weekly",
        createdBy: userIds.neelam,
        completedAt: now,
      },
      {
        title: "College list review",
        assignedTo: userIds.meer,
        category: "classes",
        startTime: atDay(0, 10),
        endTime: atDay(0, 10, 45),
        status: "Pending",
        communal: false,
        resetCadence: "none",
        createdBy: userIds.neelam,
        externalUrl: "https://meet.google.com/",
      },
      {
        title: "LADWP bill payment",
        assignedTo: userIds.neelam,
        category: "payments",
        startTime: atDay(0, 15),
        endTime: atDay(0, 15, 30),
        status: "Pending",
        communal: false,
        resetCadence: "none",
        createdBy: userIds.neelam,
      },
      {
        title: "Gut health nutritionist",
        assignedTo: userIds.vaani,
        category: "appointments",
        startTime: atDay(1, 11),
        endTime: atDay(1, 12),
        status: "Pending",
        communal: false,
        resetCadence: "none",
        createdBy: userIds.neelam,
        externalUrl: "https://practicebetter.io/",
      },
    ]
    const taskIds = []

    for (const task of taskSeeds) {
      const taskId = await ctx.db.insert("householdTasks", {
        ...task,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })

      taskIds.push(taskId)
    }

    await ctx.db.insert("homeControls", {
      label: "Sprinklers",
      value: "Tonight 8:00 PM",
      status: "Ready",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("homeControls", {
      label: "Climate",
      value: "Eco 73 F",
      status: "Active",
      updatedBy: userIds.neelam,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("homeControls", {
      label: "Entry controls",
      value: "Secured",
      status: "Locked",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("notificationLog", {
      memberId: userIds.neelam,
      taskId: taskIds[1],
      kind: "digest",
      title: "Morning digest ready",
      body: "Today has chores, one class checkpoint, and one bill reminder.",
      isDemo: true,
      createdAt: now,
    })
    await ctx.db.insert("notificationLog", {
      memberId: userIds.meer,
      taskId: taskIds[1],
      kind: "assignment",
      title: "Assignment alert",
      body: "College List Review was sent to Meer.",
      isDemo: true,
      createdAt: now,
    })

    return {
      seeded: true,
      users: sortUsers(await ctx.db.query("householdUsers").collect()).filter(
        (user) => user.isDemo,
      ),
      taskCount: taskSeeds.length,
      homeControlCount: 3,
    }
  },
})
