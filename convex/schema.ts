import { authTables } from "@convex-dev/auth/server"
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

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

const notificationKind = v.union(
  v.literal("digest"),
  v.literal("due"),
  v.literal("assignment"),
  v.literal("security"),
  v.literal("missed"),
)

const homeControlStatus = v.union(
  v.literal("Locked"),
  v.literal("Ready"),
  v.literal("Active"),
  v.literal("Paused"),
)

export default defineSchema({
  ...authTables,
  householdUsers: defineTable({
    name: v.string(),
    role: householdRole,
    avatarIcon: v.string(),
    color: v.string(),
    pinHash: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    sortOrder: v.number(),
    isDemo: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authSubject", ["authSubject"])
    .index("by_isDemo", ["isDemo"])
    .index("by_sortOrder", ["sortOrder"]),
  householdContactProfiles: defineTable({
    authUserId: v.id("users"),
    email: v.string(),
    phone: v.string(),
    emailEnabled: v.boolean(),
    smsEnabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_authUserId", ["authUserId"]),
  householdTasks: defineTable({
    title: v.string(),
    assignedTo: v.id("householdUsers"),
    category: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    status: taskStatus,
    communal: v.boolean(),
    resetCadence,
    createdBy: v.id("householdUsers"),
    externalUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    reminder: v.optional(taskReminder),
    isDemo: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_assignedTo_status_startTime", [
      "assignedTo",
      "status",
      "startTime",
    ])
    .index("by_category_status", ["category", "status"])
    .index("by_communal_status", ["communal", "status"])
    .index("by_isDemo", ["isDemo"])
    .index("by_startTime", ["startTime"]),
  notificationLog: defineTable({
    memberId: v.optional(v.id("householdUsers")),
    taskId: v.optional(v.id("householdTasks")),
    kind: notificationKind,
    title: v.string(),
    body: v.string(),
    readAt: v.optional(v.number()),
    isDemo: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_member_createdAt", ["memberId", "createdAt"])
    .index("by_task_createdAt", ["taskId", "createdAt"])
    .index("by_isDemo", ["isDemo"]),
  homeControls: defineTable({
    label: v.string(),
    value: v.string(),
    status: homeControlStatus,
    updatedBy: v.optional(v.id("householdUsers")),
    isDemo: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_isDemo", ["isDemo"]),
})
