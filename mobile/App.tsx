import { Ionicons } from "@expo/vector-icons"
import {
  ConvexAuthProvider,
  useAuthActions,
  useConvexAuth,
} from "@convex-dev/auth/react"
import { StatusBar } from "expo-status-bar"
import {
  type ComponentProps,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native"
import { ConvexReactClient, useAction, useMutation, useQuery } from "convex/react"

import { householdApi } from "./src/api"
import { secureTokenStorage } from "./src/secure-storage"
import type {
  ContactProfile,
  HouseholdAggregate,
  HouseholdTask,
  HouseholdUser,
} from "./src/types"

const convexUrl =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.EXPO_PUBLIC_CONVEX_URL ??
  "https://basic-caterpillar-18.convex.cloud"
const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
})

const COLORS = {
  background: "#f3f6f8",
  surface: "#ffffff",
  ink: "#20262d",
  muted: "#66737f",
  border: "#d7e0e6",
  dark: "#182026",
  green: "#22c55e",
  yellow: "#eab308",
  purple: "#a855f7",
  blue: "#3b82f6",
  red: "#dc2626",
} as const

const CATEGORIES = [
  { id: "chores", label: "Chores", color: COLORS.green },
  { id: "classes", label: "Classes", color: COLORS.yellow },
  { id: "payments", label: "Bills", color: COLORS.purple },
  { id: "appointments", label: "Appointments", color: COLORS.blue },
] as const

const REMINDER_OPTIONS = [
  { value: "none", label: "No reminder", detail: "No email or SMS reminder" },
  { value: "15", label: "15 minutes before", detail: "Close to start time" },
  { value: "30", label: "30 minutes before", detail: "Useful for appointments" },
  { value: "60", label: "1 hour before", detail: "A little more lead time" },
  { value: "1440", label: "1 day before", detail: "Plan ahead" },
  { value: "2880", label: "2 days before", detail: "Useful for bills" },
] as const

type IconName = ComponentProps<typeof Ionicons>["name"]
type AppTab = "agenda" | "add" | "profile"
type ReminderValue = (typeof REMINDER_OPTIONS)[number]["value"]

export default function App() {
  return (
    <ConvexAuthProvider client={convex} storage={secureTokenStorage}>
      <StatusBar style="dark" />
      <AppGate />
    </ConvexAuthProvider>
  )
}

function AppGate() {
  const { isAuthenticated, isLoading } = useConvexAuth()

  if (isLoading) {
    return <LoadingScreen label="Opening your household" />
  }

  return isAuthenticated ? <HouseholdApp /> : <SignInScreen />
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.loadingScreen}>
      <Image source={require("./assets/icon.png")} style={styles.loadingIcon} />
      <ActivityIndicator color={COLORS.dark} size="small" />
      <Text style={styles.loadingLabel}>{label}</Text>
    </SafeAreaView>
  )
}

function SignInScreen() {
  const { signIn } = useAuthActions()
  const resetPassword = useAction(householdApi.resetPasswordWithRecoveryCode)
  const saveContactProfile = useAction(householdApi.saveMyContactProfile)
  const [mode, setMode] = useState<"signIn" | "signUp" | "reset">("signIn")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [recoveryCode, setRecoveryCode] = useState("")
  const [setupCode, setSetupCode] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const isSignUp = mode === "signUp"
  const isReset = mode === "reset"

  async function submit() {
    const normalizedUsername = username.trim().toLowerCase()

    if (!normalizedUsername || !password) {
      Alert.alert("Missing details", "Enter a username and password.")
      return
    }

    if (password.length < 8) {
      Alert.alert("Choose a longer password", "Passwords must have at least 8 characters.")
      return
    }

    if (isReset && !recoveryCode) {
      Alert.alert("Recovery code needed", "Enter the household recovery code.")
      return
    }

    if (isSignUp && (!setupCode || !email.trim() || !phone.trim())) {
      Alert.alert(
        "Complete account setup",
        "Enter your email, phone number, and the household setup code.",
      )
      return
    }

    setSubmitting(true)
    try {
      if (isReset) {
        await resetPassword({
          username: normalizedUsername,
          newPassword: password,
          recoveryCode,
        })
        setPassword("")
        setRecoveryCode("")
        setMode("signIn")
        Alert.alert("Password reset", "Sign in with your new password.")
        return
      }

      const result = await signIn("password", {
        flow: isSignUp ? "signUp" : "signIn",
        username: normalizedUsername,
        password,
        ...(isSignUp ? { setupCode } : {}),
      })

      if (isSignUp && result.signingIn) {
        try {
          await saveContactProfile({
            username: normalizedUsername,
            currentPassword: password,
            email: email.trim(),
            phone: phone.trim(),
            emailEnabled: true,
            smsEnabled: false,
          })
        } catch {
          Alert.alert(
            "Account created",
            "Sign in succeeded. Add your reminder contact details from Profile if they were not saved yet.",
          )
        }
      }
    } catch {
      Alert.alert(
        isReset ? "Could not reset password" : "Could not sign in",
        isReset
          ? "Check the username and household recovery code."
          : "Check your details and try again.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const title = isReset
    ? "Reset password"
    : isSignUp
      ? "Create account"
      : "Welcome back"
  const subtitle = isReset
    ? "Use the household recovery code to make a new password."
    : isSignUp
      ? "Set up your approved household account."
      : "Your household calendar, in your pocket."

  return (
    <SafeAreaView style={styles.authScreen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.authKeyboard}
      >
        <ScrollView
          contentContainerStyle={styles.authContent}
          keyboardShouldPersistTaps="handled"
        >
          <Image source={require("./assets/icon.png")} style={styles.authIcon} />
          <Text style={styles.authEyebrow}>HOUSEHOLD PLANNER</Text>
          <Text style={styles.authTitle}>{title}</Text>
          <Text style={styles.authSubtitle}>{subtitle}</Text>

          <View style={styles.authCard}>
            <Field
              autoCapitalize="none"
              autoComplete="username"
              label="Username"
              onChangeText={setUsername}
              value={username}
            />
            <Field
              autoComplete={isSignUp || isReset ? "new-password" : "current-password"}
              label={isReset ? "New password" : "Password"}
              onChangeText={setPassword}
              secureTextEntry
              value={password}
            />
            {isReset ? (
              <Field
                autoComplete="one-time-code"
                label="Household recovery code"
                onChangeText={setRecoveryCode}
                secureTextEntry
                value={recoveryCode}
              />
            ) : null}
            {isSignUp ? (
              <>
                <Field
                  autoComplete="email"
                  keyboardType="email-address"
                  label="Email for reminders"
                  onChangeText={setEmail}
                  value={email}
                />
                <Field
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  label="Phone for reminders"
                  onChangeText={setPhone}
                  value={phone}
                />
                <Field
                  autoComplete="one-time-code"
                  label="Household setup code"
                  onChangeText={setSetupCode}
                  secureTextEntry
                  value={setupCode}
                />
              </>
            ) : null}
            <PrimaryButton
              disabled={submitting}
              icon={isReset ? "key-outline" : "log-in-outline"}
              label={
                submitting
                  ? "Please wait"
                  : isReset
                    ? "Reset password"
                    : isSignUp
                      ? "Create household account"
                      : "Sign in"
              }
              onPress={() => void submit()}
            />
          </View>

          <View style={styles.authLinks}>
            {!isReset ? (
              <TextButton
                label={isSignUp ? "I already have an account" : "Set up an approved account"}
                onPress={() => setMode(isSignUp ? "signIn" : "signUp")}
              />
            ) : null}
            <TextButton
              label={isReset ? "Back to sign in" : "Forgot password?"}
              onPress={() => setMode(isReset ? "signIn" : "reset")}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function HouseholdApp() {
  const { signOut } = useAuthActions()
  const viewer = useQuery(householdApi.getCurrentViewer) as
    | { username: string }
    | undefined
  const aggregate = useQuery(householdApi.listAggregateTasks, {}) as
    | HouseholdAggregate
    | undefined
  const [activeTab, setActiveTab] = useState<AppTab>("agenda")
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))

  if (!viewer || !aggregate) {
    return <LoadingScreen label="Syncing household plans" />
  }

  const currentUser = aggregate.users.find(
    (user) => normalizeUserName(user.name) === viewer.username,
  )

  return (
    <SafeAreaView style={styles.appShell}>
      <View style={styles.appHeader}>
        <View style={styles.brandLine}>
          <Image source={require("./assets/icon.png")} style={styles.headerIcon} />
          <View>
            <Text style={styles.brandName}>Household</Text>
            <Text style={styles.brandDetail}>Signed in as {viewer.username}</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="Sign out"
          hitSlop={10}
          onPress={() => {
            Alert.alert("Sign out?", "You can sign back in at any time.", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void signOut() },
            ])
          }}
          style={styles.headerAction}
        >
          <Ionicons color={COLORS.muted} name="log-out-outline" size={21} />
        </Pressable>
      </View>

      {activeTab === "agenda" ? (
        <AgendaScreen
          aggregate={aggregate}
          onAdd={() => setActiveTab("add")}
          onSelectDate={setSelectedDate}
          onShiftWeek={(days) => {
            setWeekStart((current) => addDays(current, days))
            setSelectedDate((current) => addDays(current, days))
          }}
          selectedDate={selectedDate}
          weekStart={weekStart}
        />
      ) : null}
      {activeTab === "add" ? (
        <TaskComposer
          creator={currentUser}
          onCreated={() => setActiveTab("agenda")}
          selectedDate={selectedDate}
          users={aggregate.users}
        />
      ) : null}
      {activeTab === "profile" ? <ProfileScreen username={viewer.username} /> : null}

      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  )
}

function AgendaScreen({
  aggregate,
  selectedDate,
  weekStart,
  onSelectDate,
  onShiftWeek,
  onAdd,
}: {
  aggregate: HouseholdAggregate
  selectedDate: Date
  weekStart: Date
  onSelectDate: (date: Date) => void
  onShiftWeek: (days: number) => void
  onAdd: () => void
}) {
  const toggleTask = useMutation(householdApi.toggleTaskDone)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const tasks = aggregate.tasks.filter((task) => isSameDay(new Date(task.startTime), selectedDate))
  const pendingToday = tasks.filter((task) => task.status === "Pending").length

  async function completeTask(task: HouseholdTask) {
    try {
      await toggleTask({
        taskId: task._id,
        status: task.status === "Done" ? "Pending" : "Done",
      })
    } catch {
      Alert.alert("Could not update task", "Check your connection and try again.")
    }
  }

  async function openTask(task: HouseholdTask) {
    if (task.externalUrl) {
      try {
        await Linking.openURL(task.externalUrl)
      } catch {
        Alert.alert("Could not open link", "The task link is not available on this device.")
      }
      return
    }

    Alert.alert(task.title, task.notes?.trim() || "No notes were added to this task.")
  }

  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <View style={styles.agendaHeading}>
        <View>
          <Text style={styles.screenTitle}>{friendlyDate(selectedDate)}</Text>
          <Text style={styles.screenSubtitle}>
            {pendingToday === 1 ? "1 task still open" : `${pendingToday} tasks still open`}
          </Text>
        </View>
        <Pressable accessibilityLabel="Add task" onPress={onAdd} style={styles.addTaskButton}>
          <Ionicons color="#ffffff" name="add" size={24} />
        </Pressable>
      </View>

      <View style={styles.weekCard}>
        <View style={styles.weekToolbar}>
          <Pressable accessibilityLabel="Previous week" onPress={() => onShiftWeek(-7)} style={styles.weekArrow}>
            <Ionicons color={COLORS.ink} name="chevron-back" size={20} />
          </Pressable>
          <Text style={styles.monthLabel}>{monthRangeLabel(weekStart)}</Text>
          <Pressable accessibilityLabel="Next week" onPress={() => onShiftWeek(7)} style={styles.weekArrow}>
            <Ionicons color={COLORS.ink} name="chevron-forward" size={20} />
          </Pressable>
        </View>
        <View style={styles.daysRow}>
          {days.map((day) => {
            const isSelected = isSameDay(day, selectedDate)
            const count = aggregate.tasks.filter((task) => isSameDay(new Date(task.startTime), day) && task.status === "Pending").length
            return (
              <Pressable
                accessibilityLabel={`Show ${friendlyDate(day)}`}
                key={day.toISOString()}
                onPress={() => onSelectDate(day)}
                style={[styles.dayCell, isSelected && styles.dayCellSelected]}
              >
                <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>{weekdayShort(day)}</Text>
                <Text style={[styles.dayNumber, isSelected && styles.dayTextSelected]}>{day.getDate()}</Text>
                <View style={[styles.dayCount, isSelected && styles.dayCountSelected]}>
                  <Text style={[styles.dayCountText, isSelected && styles.dayCountTextSelected]}>{count}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Schedule</Text>
        <Text style={styles.sectionDetail}>{tasks.length} items</Text>
      </View>

      {tasks.length === 0 ? (
        <EmptyState onAdd={onAdd} />
      ) : (
        <View style={styles.taskList}>
          {tasks.map((task) => (
            <TaskCard
              key={task._id}
              onOpen={() => void openTask(task)}
              onToggle={() => void completeTask(task)}
              task={task}
            />
          ))}
        </View>
      )}
    </ScrollView>
  )
}

function TaskCard({
  task,
  onOpen,
  onToggle,
}: {
  task: HouseholdTask
  onOpen: () => void
  onToggle: () => void
}) {
  const category = CATEGORIES.find((item) => item.id === task.category)
  const isDone = task.status === "Done"
  const isMissed = !isDone && task.endTime < Date.now()
  const accent = isMissed ? COLORS.red : (category?.color ?? COLORS.muted)

  return (
    <View style={[styles.taskCard, { borderLeftColor: accent }]}>
      <Pressable
        accessibilityLabel={isDone ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
        onPress={onToggle}
        style={[styles.checkButton, isDone && styles.checkButtonDone, isMissed && styles.checkButtonMissed]}
      >
        <Ionicons color="#ffffff" name={isDone ? "checkmark" : "close"} size={17} />
      </Pressable>
      <Pressable accessibilityRole={task.externalUrl ? "link" : "button"} onPress={onOpen} style={styles.taskBody}>
        <View style={styles.taskTitleLine}>
          <Text numberOfLines={2} style={[styles.taskTitle, isDone && styles.taskTitleDone]}>
            {task.title}
          </Text>
          {task.externalUrl ? <Ionicons color={COLORS.muted} name="link-outline" size={17} /> : null}
        </View>
        <Text style={styles.taskMeta}>
          {timeRange(task.startTime, task.endTime)} · {task.assignedUser?.name ?? "Household"}
        </Text>
        <View style={styles.taskTags}>
          <View style={[styles.categoryTag, { backgroundColor: `${accent}1f` }]}>
            <Text style={[styles.categoryTagText, { color: accent }]}>{category?.label ?? task.category}</Text>
          </View>
          {task.communal ? <Text style={styles.communalLabel}>Shared</Text> : null}
          {isMissed ? <Text style={styles.missedLabel}>Missed</Text> : null}
        </View>
      </Pressable>
    </View>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons color={COLORS.muted} name="calendar-outline" size={31} />
      <Text style={styles.emptyTitle}>Nothing scheduled</Text>
      <Text style={styles.emptyDetail}>Enjoy the space, or add something for this day.</Text>
      <SecondaryButton icon="add-outline" label="Add task" onPress={onAdd} />
    </View>
  )
}

function TaskComposer({
  creator,
  users,
  selectedDate,
  onCreated,
}: {
  creator: HouseholdUser | undefined
  users: HouseholdUser[]
  selectedDate: Date
  onCreated: () => void
}) {
  const createTask = useMutation(householdApi.createTask)
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [startTime, setStartTime] = useState("09:00")
  const [endTime, setEndTime] = useState("10:00")
  const [category, setCategory] = useState<string>("chores")
  const [assignedTo, setAssignedTo] = useState<string>(creator?._id ?? "")
  const [communal, setCommunal] = useState(false)
  const [reminder, setReminder] = useState<ReminderValue>("none")
  const [selector, setSelector] = useState<"assignee" | "reminder" | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!assignedTo && creator) {
      setAssignedTo(creator._id)
    }
  }, [assignedTo, creator])

  const assignee = users.find((user) => user._id === assignedTo)
  const reminderLabel = REMINDER_OPTIONS.find((option) => option.value === reminder)?.label ?? "No reminder"

  async function saveTask() {
    if (!title.trim()) {
      Alert.alert("Task title needed", "Give this item a clear name before adding it.")
      return
    }

    if (!creator || !assignee) {
      Alert.alert("Household profile needed", "This account is not linked to a household member yet.")
      return
    }

    const start = timeOnDay(selectedDate, startTime)
    const end = timeOnDay(selectedDate, endTime)

    if (start === undefined || end === undefined) {
      Alert.alert("Use a valid time", "Enter start and end times as HH:MM, for example 09:30.")
      return
    }

    if (end <= start) {
      Alert.alert("Check the end time", "The end time must be after the start time.")
      return
    }

    setSaving(true)
    try {
      await createTask({
        title: title.trim(),
        assignedTo: assignee._id,
        category,
        startTime: start,
        endTime: end,
        communal,
        resetCadence: "none",
        createdBy: creator._id,
        notes: notes.trim() || undefined,
        reminder: {
          enabled: reminder !== "none",
          timings: reminder === "none" ? [] : [reminder],
          email: reminder !== "none",
          sms: false,
        },
      })
      setTitle("")
      setNotes("")
      setReminder("none")
      Alert.alert("Added to the calendar", "The household view has updated.")
      onCreated()
    } catch {
      Alert.alert("Could not add task", "Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.composerContent} keyboardShouldPersistTaps="handled">
        <View style={styles.composerHeading}>
          <Text style={styles.screenTitle}>New task</Text>
          <Text style={styles.screenSubtitle}>For {friendlyDate(selectedDate)}</Text>
        </View>

        <View style={styles.formCard}>
          <Field label="Task title" onChangeText={setTitle} placeholder="What needs to happen?" value={title} />
          <Field
            label="Notes"
            multiline
            onChangeText={setNotes}
            placeholder="Helpful context, directions, or details"
            value={notes}
          />

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.categoryChoices}>
            {CATEGORIES.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setCategory(item.id)}
                style={[
                  styles.categoryChoice,
                  category === item.id && { borderColor: item.color, backgroundColor: `${item.color}18` },
                ]}
              >
                <View style={[styles.categoryDot, { backgroundColor: item.color }]} />
                <Text style={styles.categoryChoiceText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.timeGrid}>
            <Field
              keyboardType="numbers-and-punctuation"
              label="Starts"
              onChangeText={setStartTime}
              placeholder="09:00"
              value={startTime}
            />
            <Field
              keyboardType="numbers-and-punctuation"
              label="Ends"
              onChangeText={setEndTime}
              placeholder="10:00"
              value={endTime}
            />
          </View>

          <SelectRow
            detail={assignee?.role ?? "Choose who owns this"}
            icon="person-outline"
            label="Assigned to"
            onPress={() => setSelector("assignee")}
            value={assignee?.name ?? "Choose person"}
          />
          <SelectRow
            detail="Email delivery uses this member's profile settings"
            icon="notifications-outline"
            label="Reminder"
            onPress={() => setSelector("reminder")}
            value={reminderLabel}
          />
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.switchTitle}>Shared household task</Text>
              <Text style={styles.switchDetail}>Anyone can see and complete it.</Text>
            </View>
            <Switch
              onValueChange={setCommunal}
              thumbColor="#ffffff"
              trackColor={{ false: COLORS.border, true: COLORS.green }}
              value={communal}
            />
          </View>
        </View>

        <PrimaryButton
          disabled={saving}
          icon="calendar-outline"
          label={saving ? "Adding task" : "Add to calendar"}
          onPress={() => void saveTask()}
        />
      </ScrollView>
      <OptionSheet
        onClose={() => setSelector(undefined)}
        onSelect={(value) => {
          if (selector === "assignee") {
            setAssignedTo(value)
          } else if (selector === "reminder") {
            setReminder(value as ReminderValue)
          }
          setSelector(undefined)
        }}
        options={
          selector === "assignee"
            ? users.map((user) => ({ value: user._id, label: user.name, detail: user.role }))
            : REMINDER_OPTIONS.map((option) => option)
        }
        title={selector === "assignee" ? "Assign task" : "Set reminder"}
        visible={selector !== undefined}
      />
    </>
  )
}

function ProfileScreen({ username }: { username: string }) {
  const profile = useQuery(householdApi.getMyContactProfile, {}) as
    | ContactProfile
    | undefined
  const saveContactProfile = useAction(householdApi.saveMyContactProfile)
  const changePassword = useAction(householdApi.changeMyPassword)
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [contactPassword, setContactPassword] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [savingContact, setSavingContact] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (profile) {
      setEmail(profile.email)
      setPhone(profile.phone)
      setEmailEnabled(profile.emailEnabled)
      setSmsEnabled(profile.smsEnabled)
    }
  }, [profile])

  if (!profile) {
    return <LoadingScreen label="Loading your profile" />
  }

  async function saveContact() {
    if (!contactPassword) {
      Alert.alert("Password required", "Enter your current password to update reminder contacts.")
      return
    }

    setSavingContact(true)
    try {
      await saveContactProfile({
        username,
        currentPassword: contactPassword,
        email: email.trim(),
        phone: phone.trim(),
        emailEnabled,
        smsEnabled,
      })
      setContactPassword("")
      Alert.alert("Reminder settings saved", "Your personal contact information was updated.")
    } catch {
      Alert.alert("Could not save settings", "Check your current password and try again.")
    } finally {
      setSavingContact(false)
    }
  }

  async function updatePassword() {
    if (!currentPassword || !newPassword) {
      Alert.alert("Password required", "Enter your current password and a new password.")
      return
    }

    if (newPassword.length < 8) {
      Alert.alert("Choose a longer password", "Passwords must have at least 8 characters.")
      return
    }

    setSavingPassword(true)
    try {
      await changePassword({ username, currentPassword, newPassword })
      setCurrentPassword("")
      setNewPassword("")
      Alert.alert("Password changed", "Your new password now works on the web and the mobile app.")
    } catch {
      Alert.alert("Could not change password", "Check your current password and try again.")
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.profileContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.screenTitle}>Profile & reminders</Text>
      <Text style={styles.screenSubtitle}>Only your contact details are visible and editable here.</Text>

      <View style={styles.profileIdentity}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>{username.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.profileUsername}>{username}</Text>
          <Text style={styles.profileHint}>Household account</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Reminder delivery</Text>
      <View style={styles.formCard}>
        <Field autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} value={email} />
        <Field autoComplete="tel" keyboardType="phone-pad" label="Phone" onChangeText={setPhone} value={phone} />
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.switchTitle}>Email reminders</Text>
            <Text style={styles.switchDetail}>Send task reminders to your email.</Text>
          </View>
          <Switch onValueChange={setEmailEnabled} trackColor={{ false: COLORS.border, true: COLORS.green }} value={emailEnabled} />
        </View>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.switchTitle}>Text reminders</Text>
            <Text style={styles.switchDetail}>Use your phone number for SMS reminders.</Text>
          </View>
          <Switch onValueChange={setSmsEnabled} trackColor={{ false: COLORS.border, true: COLORS.green }} value={smsEnabled} />
        </View>
        <Field
          autoComplete="current-password"
          label="Current password to save changes"
          onChangeText={setContactPassword}
          secureTextEntry
          value={contactPassword}
        />
        <SecondaryButton
          icon="save-outline"
          label={savingContact ? "Saving" : "Save reminder settings"}
          onPress={() => void saveContact()}
        />
      </View>

      <Text style={styles.sectionTitle}>Change password</Text>
      <View style={styles.formCard}>
        <Field autoComplete="current-password" label="Current password" onChangeText={setCurrentPassword} secureTextEntry value={currentPassword} />
        <Field autoComplete="new-password" label="New password" onChangeText={setNewPassword} secureTextEntry value={newPassword} />
        <PrimaryButton
          disabled={savingPassword}
          icon="key-outline"
          label={savingPassword ? "Updating password" : "Update password"}
          onPress={() => void updatePassword()}
        />
      </View>
    </ScrollView>
  )
}

function TabBar({ activeTab, onChange }: { activeTab: AppTab; onChange: (tab: AppTab) => void }) {
  const tabs: Array<{ id: AppTab; label: string; icon: IconName }> = [
    { id: "agenda", label: "Calendar", icon: "calendar-outline" },
    { id: "add", label: "New task", icon: "add-circle-outline" },
    { id: "profile", label: "Profile", icon: "person-outline" },
  ]

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id
        return (
          <Pressable
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={styles.tabButton}
          >
            <Ionicons color={active ? COLORS.dark : COLORS.muted} name={tab.icon} size={22} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function OptionSheet({
  visible,
  title,
  options,
  onClose,
  onSelect,
}: {
  visible: boolean
  title: string
  options: Array<{ value: string; label: string; detail: string }>
  onClose: () => void
  onSelect: (value: string) => void
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.optionSheet}>
          <View style={styles.optionSheetHeader}>
            <Text style={styles.optionSheetTitle}>{title}</Text>
            <Pressable accessibilityLabel="Close selection" onPress={onClose} style={styles.sheetClose}>
              <Ionicons color={COLORS.ink} name="close" size={21} />
            </Pressable>
          </View>
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={styles.optionRow}
            >
              <View>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
              <Ionicons color={COLORS.muted} name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  )
}

function Field({
  label,
  multiline = false,
  ...props
}: TextInputProps & { label: string; multiline?: boolean }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        multiline={multiline}
        placeholderTextColor="#8a96a2"
        style={[styles.input, multiline && styles.textArea]}
        textAlignVertical={multiline ? "top" : "center"}
        {...props}
      />
    </View>
  )
}

function SelectRow({
  label,
  value,
  detail,
  icon,
  onPress,
}: {
  label: string
  value: string
  detail: string
  icon: IconName
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={styles.selectRow}>
      <View style={styles.selectIcon}>
        <Ionicons color={COLORS.dark} name={icon} size={19} />
      </View>
      <View style={styles.selectCopy}>
        <Text style={styles.selectLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.selectDetail}>{detail}</Text>
      </View>
      <View style={styles.selectValueGroup}>
        <Text numberOfLines={1} style={styles.selectValue}>{value}</Text>
        <Ionicons color={COLORS.muted} name="chevron-forward" size={17} />
      </View>
    </Pressable>
  )
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.buttonDisabled]}>
      <Ionicons color="#ffffff" name={icon} size={19} />
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.secondaryButton}>
      <Ionicons color={COLORS.ink} name={icon} size={18} />
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.textButton}>
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  )
}

function normalizeUserName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "")
}

function startOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function startOfWeek(date: Date) {
  const result = startOfDay(date)
  result.setDate(result.getDate() - result.getDay())
  return result
}

function addDays(date: Date, amount: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}

function isSameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

function weekdayShort(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).slice(0, 2)
}

function friendlyDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date)
}

function monthRangeLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)
}

function timeRange(start: number, end: number) {
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
  return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`
}

function timeOnDay(day: Date, value: string) {
  const match = /^(?:[01]?\d|2[0-3]):[0-5]\d$/.exec(value.trim())
  if (!match) {
    return undefined
  }

  const [hour, minute] = value.trim().split(":").map(Number)
  const result = new Date(day)
  result.setHours(hour, minute, 0, 0)
  return result.getTime()
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: COLORS.background },
  appHeader: {
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 68,
    paddingHorizontal: 20,
  },
  authCard: { gap: 14, marginTop: 28, width: "100%" },
  authContent: { alignItems: "center", flexGrow: 1, justifyContent: "center", padding: 26 },
  authEyebrow: { color: COLORS.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1.1, marginTop: 21 },
  authIcon: { borderRadius: 22, height: 88, width: 88 },
  authKeyboard: { flex: 1 },
  authLinks: { alignItems: "center", gap: 8, marginTop: 22 },
  authScreen: { backgroundColor: COLORS.background, flex: 1 },
  authSubtitle: { color: COLORS.muted, fontSize: 16, lineHeight: 23, marginTop: 8, textAlign: "center" },
  authTitle: { color: COLORS.ink, fontSize: 31, fontWeight: "700", marginTop: 8 },
  avatarCircle: { alignItems: "center", backgroundColor: COLORS.dark, borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  avatarLetter: { color: "#ffffff", fontSize: 19, fontWeight: "700" },
  brandDetail: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  brandLine: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandName: { color: COLORS.ink, fontSize: 16, fontWeight: "700" },
  buttonDisabled: { opacity: 0.55 },
  categoryChoice: { alignItems: "center", borderColor: COLORS.border, borderRadius: 7, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 39, paddingHorizontal: 10 },
  categoryChoiceText: { color: COLORS.ink, fontSize: 13, fontWeight: "600" },
  categoryChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 17 },
  categoryDot: { borderRadius: 4, height: 8, width: 8 },
  categoryTag: { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 },
  categoryTagText: { fontSize: 11, fontWeight: "700" },
  checkButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: COLORS.muted, borderRadius: 14, height: 28, justifyContent: "center", marginTop: 4, width: 28 },
  checkButtonDone: { backgroundColor: COLORS.green },
  checkButtonMissed: { backgroundColor: COLORS.red },
  communalLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  composerContent: { gap: 18, padding: 20, paddingBottom: 100 },
  composerHeading: { gap: 3 },
  dayCell: { alignItems: "center", borderRadius: 7, flex: 1, minHeight: 68, paddingTop: 5 },
  dayCellSelected: { backgroundColor: COLORS.dark },
  dayCount: { alignItems: "center", backgroundColor: "#eaf0f3", borderRadius: 8, height: 16, justifyContent: "center", marginTop: 2, minWidth: 16, paddingHorizontal: 4 },
  dayCountSelected: { backgroundColor: "#ffffff" },
  dayCountText: { color: COLORS.muted, fontSize: 9, fontWeight: "700" },
  dayCountTextSelected: { color: COLORS.dark },
  dayName: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  dayNumber: { color: COLORS.ink, fontSize: 15, fontWeight: "700", marginTop: 2 },
  dayTextSelected: { color: "#ffffff" },
  daysRow: { flexDirection: "row", gap: 3, marginTop: 10 },
  emptyDetail: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginBottom: 16, textAlign: "center" },
  emptyState: { alignItems: "center", backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 8, borderStyle: "dashed", borderWidth: 1, padding: 32 },
  emptyTitle: { color: COLORS.ink, fontSize: 16, fontWeight: "700", marginTop: 10 },
  fieldGroup: { gap: 7 },
  fieldLabel: { color: COLORS.ink, fontSize: 13, fontWeight: "700" },
  formCard: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 8, borderWidth: 1, gap: 17, padding: 16 },
  headerAction: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  headerIcon: { borderRadius: 8, height: 34, width: 34 },
  input: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 6, borderWidth: 1, color: COLORS.ink, fontSize: 16, height: 44, paddingHorizontal: 12 },
  loadingIcon: { borderRadius: 17, height: 68, marginBottom: 20, width: 68 },
  loadingLabel: { color: COLORS.muted, fontSize: 14, marginTop: 12 },
  loadingScreen: { alignItems: "center", backgroundColor: COLORS.background, flex: 1, justifyContent: "center" },
  missedLabel: { color: COLORS.red, fontSize: 11, fontWeight: "700" },
  modalOverlay: { backgroundColor: "rgba(24, 32, 38, 0.4)", flex: 1, justifyContent: "flex-end" },
  monthLabel: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  optionDetail: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  optionLabel: { color: COLORS.ink, fontSize: 16, fontWeight: "600" },
  optionRow: { alignItems: "center", borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", minHeight: 63, paddingVertical: 10 },
  optionSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: "72%", paddingBottom: 28, paddingHorizontal: 20 },
  optionSheetHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 64 },
  optionSheetTitle: { color: COLORS.ink, fontSize: 18, fontWeight: "700" },
  primaryButton: { alignItems: "center", backgroundColor: COLORS.dark, borderRadius: 7, flexDirection: "row", gap: 8, height: 48, justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  profileContent: { gap: 15, padding: 20, paddingBottom: 100 },
  profileHint: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  profileIdentity: { alignItems: "center", backgroundColor: "#e8eef1", borderRadius: 8, flexDirection: "row", gap: 12, padding: 14 },
  profileUsername: { color: COLORS.ink, fontSize: 16, fontWeight: "700" },
  screenContent: { gap: 18, padding: 20, paddingBottom: 100 },
  screenSubtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 20 },
  screenTitle: { color: COLORS.ink, fontSize: 25, fontWeight: "700" },
  secondaryButton: { alignItems: "center", backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 7, borderWidth: 1, flexDirection: "row", gap: 7, height: 43, justifyContent: "center", paddingHorizontal: 13 },
  secondaryButtonText: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  sectionDetail: { color: COLORS.muted, fontSize: 13 },
  sectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { color: COLORS.ink, fontSize: 16, fontWeight: "700" },
  selectCopy: { flex: 1, marginRight: 10 },
  selectDetail: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  selectIcon: { alignItems: "center", backgroundColor: "#e8eef1", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  selectLabel: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  selectRow: { alignItems: "center", borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, minHeight: 61, paddingVertical: 10 },
  selectValue: { color: COLORS.ink, flexShrink: 1, fontSize: 13, fontWeight: "600", textAlign: "right" },
  selectValueGroup: { alignItems: "center", flexDirection: "row", gap: 3, maxWidth: "45%" },
  sheetClose: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  switchDetail: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  switchRow: { alignItems: "center", borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", minHeight: 64, paddingVertical: 10 },
  switchTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "700" },
  tabBar: { backgroundColor: COLORS.surface, borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", minHeight: 64, paddingBottom: 4 },
  tabButton: { alignItems: "center", flex: 1, gap: 3, justifyContent: "center", minHeight: 58 },
  tabLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
  tabLabelActive: { color: COLORS.dark },
  taskBody: { flex: 1, gap: 5 },
  taskCard: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderLeftWidth: 4, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, padding: 13 },
  taskList: { gap: 10 },
  taskMeta: { color: COLORS.muted, fontSize: 12 },
  taskTags: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 1 },
  taskTitle: { color: COLORS.ink, flex: 1, fontSize: 16, fontWeight: "700" },
  taskTitleDone: { color: COLORS.muted, textDecorationLine: "line-through" },
  taskTitleLine: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  textArea: { height: 96, paddingTop: 11 },
  textButton: { minHeight: 30, justifyContent: "center", paddingHorizontal: 8 },
  textButtonLabel: { color: COLORS.muted, fontSize: 14, textDecorationLine: "underline" },
  timeGrid: { flexDirection: "row", gap: 12 },
  weekArrow: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  weekCard: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 8, borderWidth: 1, padding: 12 },
  weekToolbar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  agendaHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  addTaskButton: { alignItems: "center", backgroundColor: COLORS.dark, borderRadius: 23, height: 46, justifyContent: "center", width: 46 },
})
