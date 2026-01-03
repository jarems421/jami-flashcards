
import { db } from "./db";
import webpush from "web-push";
import { startOfDay, addDays } from "date-fns";
import { toZonedTime, format as formatTz } from "date-fns-tz";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:support@jami.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

async function sendPushToUser(userId: string, payload: object): Promise<number> {
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  
  if (subscriptions.length === 0) return 0;

  const payloadStr = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payloadStr)
    )
  );

  return results.filter(r => r.status === "fulfilled").length;
}

async function checkDailyReminders() {
  const now = new Date();

  const preferences = await db.userPreference.findMany({
    where: {
      dailyReminderEnabled: true,
      dailyReminderTime: { not: null }
    }
  });

  for (const pref of preferences) {
    if (!pref.dailyReminderTime) continue;
    
    const userTz = pref.timezone || "UTC";
    const userNow = toZonedTime(now, userTz);
    const userTodayStart = startOfDay(userNow);
    
    if (pref.lastDailyReminderSent) {
      const lastSentInUserTz = toZonedTime(pref.lastDailyReminderSent, userTz);
      const lastSentDayStart = startOfDay(lastSentInUserTz);
      if (lastSentDayStart.getTime() >= userTodayStart.getTime()) {
        continue;
      }
    }
    
    const currentTimeStr = formatTz(userNow, "HH:mm", { timeZone: userTz });
    const [currentHour, currentMinute] = currentTimeStr.split(":").map(Number);
    const [reminderHour, reminderMinute] = pref.dailyReminderTime.split(":").map(Number);
    
    if (currentHour === reminderHour && Math.abs(currentMinute - reminderMinute) <= 5) {
      const sent = await sendPushToUser(pref.userId, {
        title: "Time to Study!",
        body: "Don't forget to review your flashcards today.",
        icon: "/pwa-192x192.png",
        url: "/study"
      });

      if (sent > 0) {
        await db.userPreference.update({
          where: { id: pref.id },
          data: { lastDailyReminderSent: now }
        });
        console.log(`[Scheduler] Sent daily reminder to user ${pref.userId} (timezone: ${userTz})`);
      }
    }
  }
}

async function checkGoalDeadlines() {
  const now = new Date();

  const preferences = await db.userPreference.findMany({
    where: { goalDeadlineAlerts: true }
  });

  for (const pref of preferences) {
    const userTz = pref.timezone || "UTC";
    const userNow = toZonedTime(now, userTz);
    const userTodayStart = startOfDay(userNow);
    
    const daysBefore = pref.goalAlertDaysBefore || 1;
    
    const goals = await db.studyGoal.findMany({
      where: {
        deck: { userId: pref.userId },
        status: "ACTIVE",
        deadline: { not: null }
      },
      include: { deck: true }
    });

    for (const goal of goals) {
      if (!goal.deadline) continue;
      
      const deadlineInUserTz = toZonedTime(goal.deadline, userTz);
      const deadlineDayStart = startOfDay(deadlineInUserTz);
      const daysUntil = Math.ceil((deadlineDayStart.getTime() - userTodayStart.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntil <= daysBefore && daysUntil >= 0) {
        const deckName = goal.deck?.name || "your deck";
        const urgency = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
        
        await sendPushToUser(pref.userId, {
          title: "Goal Deadline Approaching",
          body: `Your goal for "${deckName}" is due ${urgency}!`,
          icon: "/pwa-192x192.png",
          url: "/goals",
          tag: `goal-deadline-${goal.id}`
        });
        
        console.log(`[Scheduler] Sent goal deadline alert for goal ${goal.id} to user ${pref.userId} (timezone: ${userTz})`);
      }
    }
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (schedulerInterval) return;
  
  console.log("[Scheduler] Starting notification scheduler...");
  
  schedulerInterval = setInterval(async () => {
    try {
      await checkDailyReminders();
      await checkGoalDeadlines();
    } catch (e) {
      console.error("[Scheduler] Error:", e);
    }
  }, 60 * 1000);

  setTimeout(async () => {
    try {
      await checkDailyReminders();
      await checkGoalDeadlines();
    } catch (e) {
      console.error("[Scheduler] Initial check error:", e);
    }
  }, 5000);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Stopped notification scheduler");
  }
}
