import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { parseCloze } from "../shared/cloze";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";
import { isAuthenticated } from "./replit_integrations/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:support@jami.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

function getUserId(req: Request): string | null {
  return (req.user as any)?.claims?.sub ?? null;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.use("/uploads", (req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    next();
  });
  
  app.use("/uploads", (await import("express")).default.static(uploadDir));

  app.post("/api/upload", isAuthenticated, upload.single("file"), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const url = `/uploads/${req.file.filename}`;
      res.json({ url, filename: req.file.filename });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // --- Push Notifications ---

  app.get("/api/push/vapid-public-key", (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription" });
      }

      await db.pushSubscription.upsert({
        where: { endpoint },
        update: { p256dh: keys.p256dh, auth: keys.auth, userId },
        create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId }
      });

      res.json({ success: true });
    } catch (e) {
      console.error("Push subscribe error:", e);
      res.status(500).json({ error: "Failed to save subscription" });
    }
  });

  app.delete("/api/push/subscribe", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { endpoint } = req.body;
      if (endpoint) {
        await db.pushSubscription.deleteMany({ where: { endpoint } });
      }
      res.json({ success: true });
    } catch (e) {
      console.error("Push unsubscribe error:", e);
      res.status(500).json({ error: "Failed to remove subscription" });
    }
  });

  app.post("/api/push/test", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
      
      if (subscriptions.length === 0) {
        return res.status(400).json({ error: "No push subscriptions found" });
      }

      const payload = JSON.stringify({
        title: "Jami",
        body: "Push notifications are working! Time to study.",
        icon: "/pwa-192x192.png",
        url: "/study"
      });

      const results = await Promise.allSettled(
        subscriptions.map(sub => 
          webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          }, payload)
        )
      );

      const successful = results.filter(r => r.status === "fulfilled").length;
      res.json({ sent: successful, total: subscriptions.length });
    } catch (e) {
      console.error("Push test error:", e);
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  // --- User Preferences ---

  app.get("/api/preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      let prefs = await db.userPreference.findUnique({ where: { userId } });
      
      if (!prefs) {
        prefs = await db.userPreference.create({
          data: { userId, dailyReminderTime: "19:00" }
        });
      }
      
      res.json(prefs);
    } catch (e) {
      console.error("Get preferences error:", e);
      res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  app.patch("/api/preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { 
        dailyReminderEnabled, 
        dailyReminderTime, 
        goalDeadlineAlerts,
        goalAlertDaysBefore,
        timezone 
      } = req.body;

      const updateData: any = {};
      if (typeof dailyReminderEnabled === "boolean") updateData.dailyReminderEnabled = dailyReminderEnabled;
      if (dailyReminderTime) updateData.dailyReminderTime = dailyReminderTime;
      if (typeof goalDeadlineAlerts === "boolean") updateData.goalDeadlineAlerts = goalDeadlineAlerts;
      if (typeof goalAlertDaysBefore === "number") updateData.goalAlertDaysBefore = goalAlertDaysBefore;
      if (timezone) updateData.timezone = timezone;

      const prefs = await db.userPreference.upsert({
        where: { userId },
        update: updateData,
        create: { userId, ...updateData }
      });
      
      res.json(prefs);
    } catch (e) {
      console.error("Update preferences error:", e);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  // --- Queue Logic ---
  
  app.get("/api/queue/today", isAuthenticated, async (req, res) => {
    try {
      const { deckId, deckIds, tags, limit: queryLimit } = req.query;
      const todayStart = startOfDay(new Date());
      const cardLimit = queryLimit ? parseInt(queryLimit as string, 10) : 50;
      const userId = getUserId(req);

      // Support multiple deck IDs
      let deckIdList: string[] = [];
      if (deckIds) {
        deckIdList = Array.isArray(deckIds) ? deckIds as string[] : [deckIds as string];
      } else if (deckId) {
        deckIdList = [deckId as string];
      }

      // Support tag filtering
      let tagList: string[] = [];
      if (tags) {
        tagList = Array.isArray(tags) ? tags as string[] : [tags as string];
      }

      const whereDeck = deckIdList.length > 0
        ? { deckId: { in: deckIdList }, deck: { userId } } 
        : { deck: { userId } };

      // Add tag filter to where clause
      const whereClause = tagList.length > 0
        ? { ...whereDeck, note: { tags: { hasSome: tagList } } }
        : whereDeck;
      
      const cards = await db.card.findMany({
        where: whereClause,
        orderBy: [
          { lastReviewedAt: { sort: 'asc', nulls: 'first' } }
        ],
        take: cardLimit,
        include: { note: true, template: true }
      });

      const totalCards = await db.card.count({ where: whereClause });
      const newCards = await db.card.count({ where: { ...whereClause, state: 'NEW' } });
      const studiedCards = await db.card.count({ where: { ...whereClause, state: 'STUDIED' } });
      
      const studiedTodayWhere: any = {
        reviewedAt: { gte: todayStart },
        card: { 
          deck: { userId }, 
          ...(deckIdList.length > 0 ? { deckId: { in: deckIdList } } : {}),
          ...(tagList.length > 0 ? { note: { tags: { hasSome: tagList } } } : {})
        }
      };
      const studiedToday = await db.reviewLog.count({ where: studiedTodayWhere });

      res.json({
        queue: cards,
        counts: {
          totalCards,
          newCards,
          studiedCards,
          studiedToday,
          queueSize: cards.length
        }
      });

    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch queue" });
    }
  });

  // --- Tags ---
  
  app.get("/api/tags", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const notes = await db.note.findMany({
        where: { deck: { userId } },
        select: { tags: true }
      });
      
      const allTags = new Set<string>();
      notes.forEach(note => {
        note.tags.forEach(tag => allTags.add(tag));
      });
      
      res.json(Array.from(allTags).sort());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  // --- Decks & Stats ---

  app.get("/api/decks", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const decks = await db.deck.findMany({
        where: { userId },
        include: {
          _count: {
            select: { cards: true }
          },
          cards: {
            select: {
              state: true
            }
          }
        }
      });

      const result = decks.map(d => {
        const newCount = d.cards.filter(c => c.state === 'NEW').length;
        const studiedCount = d.cards.filter(c => c.state === 'STUDIED').length;
        const totalCount = d._count.cards;
        
        const { cards, ...rest } = d;
        return {
          ...rest,
          counts: {
            new: newCount,
            studied: studiedCount,
            total: totalCount
          }
        };
      });

      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch decks" });
    }
  });

  app.post("/api/decks", isAuthenticated, async (req, res) => {
    try {
      const { name, parentDeckId, color, icon } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const userId = getUserId(req);

      const deck = await db.deck.create({
        data: {
          name,
          userId,
          parentDeckId: parentDeckId || null,
          color: color || null,
          icon: icon || null
        }
      });
      res.json(deck);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create deck" });
    }
  });

  app.patch("/api/decks/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, color, icon, parentDeckId } = req.body;
      const userId = getUserId(req);
      
      const deck = await db.deck.findFirst({ where: { id, userId } });
      if (!deck) return res.status(404).json({ error: "Deck not found" });
      
      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (color !== undefined) updateData.color = color;
      if (icon !== undefined) updateData.icon = icon;
      if (parentDeckId !== undefined) updateData.parentDeckId = parentDeckId || null;
      
      const updated = await db.deck.update({
        where: { id },
        data: updateData
      });
      
      res.json(updated);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update deck" });
    }
  });

  app.delete("/api/decks/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      
      const deck = await db.deck.findFirst({ where: { id, userId } });
      if (!deck) return res.status(404).json({ error: "Deck not found" });
      
      await db.reviewLog.deleteMany({ where: { card: { deckId: id } } });
      await db.card.deleteMany({ where: { deckId: id } });
      await db.note.deleteMany({ where: { deckId: id } });
      await db.deck.delete({ where: { id } });

      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete deck" });
    }
  });

  app.get("/api/stats", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const userDeckFilter = { deck: { userId } };
      
      const totalCards = await db.card.count({ where: userDeckFilter });
      const newCards = await db.card.count({ where: { ...userDeckFilter, state: 'NEW' } });
      const studiedCards = await db.card.count({ where: { ...userDeckFilter, state: 'STUDIED' } });

      const logs = await db.reviewLog.findMany({
        where: { card: userDeckFilter },
        select: {
          rating: true,
          reviewedAt: true,
          responseTimeMs: true
        },
        orderBy: { reviewedAt: 'desc' }
      });

      const totalReviews = logs.length;
      let correctReviews = 0;
      let totalTimeMs = 0;
      const uniqueDays = new Set<string>();

      logs.forEach(log => {
        if (log.rating === 'CORRECT') {
          correctReviews++;
        }
        totalTimeMs += (log.responseTimeMs || 0);
        const day = log.reviewedAt.toISOString().split('T')[0];
        uniqueDays.add(day);
      });

      const accuracy = totalReviews > 0 
        ? Math.round((correctReviews / totalReviews) * 100) 
        : 0;

      let timeSpent = "0m";
      const minutes = Math.floor(totalTimeMs / 60000);
      if (minutes >= 60) {
        const hours = (minutes / 60).toFixed(1);
        timeSpent = `${hours}h`;
      } else {
        timeSpent = `${minutes}m`;
      }

      const sortedDays = Array.from(uniqueDays).sort().reverse();
      let streak = 0;
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const hasToday = sortedDays.includes(today);
      const hasYesterday = sortedDays.includes(yesterday);

      if (hasToday || hasYesterday) {
        let currentCheck = hasToday ? new Date() : new Date(Date.now() - 86400000);
        
        while (true) {
          const checkStr = currentCheck.toISOString().split('T')[0];
          if (uniqueDays.has(checkStr)) {
            streak++;
            currentCheck.setDate(currentCheck.getDate() - 1);
          } else {
            break;
          }
        }
      }

      const history = [];
      const accuracyHistory = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
        const dayLogs = logs.filter(l => l.reviewedAt.toISOString().split('T')[0] === dateStr);
        const count = dayLogs.length;
        const correctCount = dayLogs.filter(l => l.rating === 'CORRECT').length;
        const dayAccuracy = count > 0 ? Math.round((correctCount / count) * 100) : null;
        history.push({ date: dayName, reviews: count, fullDate: dateStr });
        accuracyHistory.push({ date: dayName, accuracy: dayAccuracy, correct: correctCount, total: count, fullDate: dateStr });
      }

      // Calculate per-deck accuracy
      const logsWithDeck = await db.reviewLog.findMany({
        where: { card: { deck: { userId } } },
        select: {
          rating: true,
          card: {
            select: {
              deckId: true,
              deck: { select: { id: true, name: true } }
            }
          }
        }
      });

      const deckStatsMap = new Map<string, { name: string; correct: number; total: number }>();
      logsWithDeck.forEach(log => {
        const deckId = log.card.deckId;
        const deckName = log.card.deck.name;
        if (!deckStatsMap.has(deckId)) {
          deckStatsMap.set(deckId, { name: deckName, correct: 0, total: 0 });
        }
        const stats = deckStatsMap.get(deckId)!;
        stats.total++;
        if (log.rating === 'CORRECT') {
          stats.correct++;
        }
      });

      const deckAccuracy = Array.from(deckStatsMap.entries()).map(([deckId, stats]) => ({
        deckId,
        deckName: stats.name,
        correct: stats.correct,
        wrong: stats.total - stats.correct,
        total: stats.total,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
      }));

      // Count decks with cards that need study (cards not reviewed today or new cards)
      const todayStart = startOfDay(new Date());
      const decksWithCards = await db.deck.findMany({
        where: { userId },
        select: {
          id: true,
          cards: {
            select: {
              id: true,
              lastReviewedAt: true,
              state: true
            }
          }
        }
      });
      
      // A deck needs to be studied if it has at least one card that:
      // - Has never been reviewed (lastReviewedAt is null), OR
      // - Was last reviewed before today
      const decksWithDueCards = decksWithCards.filter(d => {
        return d.cards.some(card => 
          !card.lastReviewedAt || new Date(card.lastReviewedAt) < todayStart
        );
      }).length;

      res.json({
        totalCards,
        newCards,
        studiedCards,
        accuracy,
        streak,
        timeSpent,
        dailyHistory: history,
        accuracyHistory,
        correctAnswers: correctReviews,
        wrongAnswers: totalReviews - correctReviews,
        deckAccuracy,
        decksWithDueCards,
        dueCards: totalCards // for backwards compat
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // --- Cards ---

  app.get("/api/cards", isAuthenticated, async (req, res) => {
    try {
      const { deckId, search } = req.query;
      const userId = getUserId(req);
      
      const whereClause: any = { deck: { userId } };
      if (deckId) {
        whereClause.deckId = deckId as string;
      }
      
      let cards = await db.card.findMany({
        where: whereClause,
        include: {
          note: true,
          template: true
        },
        orderBy: { note: { createdAt: 'desc' } }
      });
      
      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        cards = cards.filter(card => {
          const fields = card.note?.fields as any;
          const front = String(fields?.Front || '').toLowerCase();
          const back = String(fields?.Back || '').toLowerCase();
          const tags = (card.note?.tags || []).join(' ').toLowerCase();
          return front.includes(q) || back.includes(q) || tags.includes(q);
        });
      }
      
      res.json(cards);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list cards" });
    }
  });

  app.delete("/api/cards/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      
      const card = await db.card.findFirst({ where: { id, deck: { userId } } });
      if (!card) return res.status(404).json({ error: "Card not found" });
      
      await db.reviewLog.deleteMany({ where: { cardId: id } });
      await db.card.delete({ where: { id } });
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete card" });
    }
  });

  // Bulk move cards to different deck
  app.post("/api/cards/bulk-move", isAuthenticated, async (req, res) => {
    try {
      const { cardIds, deckId } = req.body;
      const userId = getUserId(req);
      
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ error: "Card IDs required" });
      }
      if (!deckId) {
        return res.status(400).json({ error: "Deck ID required" });
      }

      // Verify target deck belongs to user
      const targetDeck = await db.deck.findFirst({ where: { id: deckId, userId } });
      if (!targetDeck) {
        return res.status(404).json({ error: "Target deck not found" });
      }

      // Update cards and their notes
      const cards = await db.card.findMany({
        where: { id: { in: cardIds }, deck: { userId } },
        include: { note: true }
      });

      for (const card of cards) {
        await db.note.update({
          where: { id: card.noteId },
          data: { deckId }
        });
        await db.card.update({
          where: { id: card.id },
          data: { deckId }
        });
      }

      res.json({ success: true, movedCount: cards.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to move cards" });
    }
  });

  // Bulk update tags for cards
  app.post("/api/cards/bulk-tags", isAuthenticated, async (req, res) => {
    try {
      const { cardIds, addTags, removeTags } = req.body;
      const userId = getUserId(req);
      
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ error: "Card IDs required" });
      }

      const cards = await db.card.findMany({
        where: { id: { in: cardIds }, deck: { userId } },
        include: { note: true }
      });

      for (const card of cards) {
        let currentTags = card.note.tags || [];
        
        // Remove tags
        if (removeTags && Array.isArray(removeTags)) {
          currentTags = currentTags.filter(t => !removeTags.includes(t));
        }
        
        // Add tags
        if (addTags && Array.isArray(addTags)) {
          for (const tag of addTags) {
            if (!currentTags.includes(tag)) {
              currentTags.push(tag);
            }
          }
        }

        await db.note.update({
          where: { id: card.noteId },
          data: { tags: currentTags }
        });
      }

      res.json({ success: true, updatedCount: cards.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update tags" });
    }
  });

  app.post("/api/cards/:id/grade", isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { rating, responseTimeMs } = req.body;
    const userId = getUserId(req);

    if (!['WRONG', 'CORRECT'].includes(rating)) {
      return res.status(400).json({ error: "Invalid rating. Use WRONG or CORRECT" });
    }

    try {
      const card = await db.card.findFirst({ where: { id, deck: { userId } } });
      if (!card) return res.status(404).json({ error: "Card not found" });

      const [updatedCard] = await db.$transaction([
        db.card.update({
          where: { id },
          data: {
            state: 'STUDIED',
            reps: card.reps + 1,
            lastReviewedAt: new Date()
          }
        }),
        db.reviewLog.create({
          data: {
            cardId: id,
            rating: rating as any,
            responseTimeMs: responseTimeMs || 0
          }
        })
      ]);

      res.json(updatedCard);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to grade card" });
    }
  });

  app.post("/api/cards/:id/answer", isAuthenticated, async (req, res) => {
    res.redirect(307, `/api/cards/${req.params.id}/grade`);
  });

  // --- Notes ---

  app.put("/api/notes/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { fields, tags } = req.body;
      const userId = getUserId(req);

      const existingNote = await db.note.findFirst({ where: { id, deck: { userId } } });
      if (!existingNote) return res.status(404).json({ error: "Note not found" });

      const note = await db.note.update({
        where: { id },
        data: { fields, tags }
      });

      res.json(note);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  app.get("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const { deckId } = req.query;
      const userId = getUserId(req);
      const notes = await db.note.findMany({
        where: deckId 
          ? { deckId: deckId as string, deck: { userId } } 
          : { deck: { userId } },
        include: {
          noteType: true,
          cards: true
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(notes);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to list notes" });
    }
  });

  app.post("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const { deckId, noteTypeId, fields, content, tags } = req.body;
      const userId = getUserId(req);
      
      const noteFields = fields || content;

      let targetDeckId = deckId;
      let targetNoteTypeId = noteTypeId;

      if (!targetDeckId) {
        const deck = await db.deck.findFirst({ where: { name: "Demo", userId } });
        if (!deck) return res.status(500).json({ error: "Demo deck missing" });
        targetDeckId = deck.id;
      } else {
        const deck = await db.deck.findFirst({ where: { id: targetDeckId, userId } });
        if (!deck) return res.status(404).json({ error: "Deck not found" });
      }

      if (!targetNoteTypeId) {
        const noteType = await db.noteType.findFirst({ where: { name: "Basic" } });
        if (!noteType) return res.status(500).json({ error: "Basic note type missing" });
        targetNoteTypeId = noteType.id;
      }

      const note = await db.note.create({
        data: {
          deckId: targetDeckId,
          noteTypeId: targetNoteTypeId,
          fields: noteFields,
          tags: tags || []
        }
      });

      const templates = await db.template.findMany({ where: { noteTypeId: targetNoteTypeId } });
      
      const cardsToCreate = [];

      for (const tmpl of templates) {
        if (tmpl.id === 'reverse') continue;

        if (tmpl.id === 'cloze') {
          const text = noteFields['Text'] || noteFields['Front'] || "";
          const { indices } = parseCloze(text);
          for (const index of indices) {
            cardsToCreate.push({
              noteId: note.id,
              deckId: targetDeckId,
              templateId: tmpl.id,
              state: 'NEW' as const
            });
          }
        } else {
          cardsToCreate.push({
            noteId: note.id,
            deckId: targetDeckId,
            templateId: tmpl.id,
            state: 'NEW' as const
          });
        }
      }
      
      if (cardsToCreate.length > 0) {
        await db.card.createMany({ data: cardsToCreate });
      }

      res.json({ success: true, noteId: note.id, cardsGenerated: cardsToCreate.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create note" });
    }
  });


  // --- Seed ---

  app.post("/api/debug/seed", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const existingDecks = await db.deck.count({ where: { userId } });
      if (existingDecks > 0) {
        return res.status(400).json({ error: "Database already seeded" });
      }

      const basicType = await db.noteType.create({
        data: {
          name: "Basic",
          fields: ["Front", "Back"],
        },
      });

      const basicTemplate = await db.template.create({
        data: {
          id: "basic",
          noteTypeId: basicType.id,
          frontHTML: "{{Front}}",
          backHTML: "{{FrontSide}}<hr id=answer>{{Back}}",
        },
      });

      await db.template.create({
        data: {
          id: "reverse",
          noteTypeId: basicType.id,
          frontHTML: "{{Back}}",
          backHTML: "{{FrontSide}}<hr id=answer>{{Front}}",
        },
      });

      const deck = await db.deck.create({
        data: { name: "Demo", userId },
      });

      const note = await db.note.create({
        data: {
          deckId: deck.id,
          noteTypeId: basicType.id,
          fields: { Front: "What is the capital of France?", Back: "Paris" },
          tags: ["geography", "demo"],
        },
      });

      await db.card.create({
        data: {
          noteId: note.id,
          deckId: deck.id,
          templateId: basicTemplate.id,
          state: "NEW",
        },
      });

      res.json({ success: true, message: "Database seeded successfully" });
    } catch (error) {
      console.error("Seeding error:", error);
      res.status(500).json({ error: "Failed to seed database" });
    }
  });

  // --- Study Goals ---

  app.get("/api/goals", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const goals = await db.studyGoal.findMany({
        where: { OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true, progress: true },
        orderBy: { createdAt: 'desc' }
      });
      res.json(goals.filter(g => g.deckId === null || g.deck?.userId === userId));
    } catch (error) {
      console.error("Error fetching goals:", error);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  app.get("/api/goals/active", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const goals = await db.studyGoal.findMany({
        where: { status: 'ACTIVE', OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true, progress: true },
        orderBy: { createdAt: 'desc' }
      });
      res.json(goals.filter(g => g.deckId === null || g.deck?.userId === userId));
    } catch (error) {
      console.error("Error fetching active goals:", error);
      res.status(500).json({ error: "Failed to fetch active goals" });
    }
  });

  app.post("/api/goals", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        deckId: z.string().uuid().optional().nullable(),
        cadence: z.enum(['DAILY', 'WEEKLY']).default('DAILY'),
        targetCount: z.number().int().positive().default(20),
        targetAccuracy: z.number().int().min(1).max(100).optional().nullable(),
        deadline: z.string().datetime().optional().nullable(),
      });
      const data = schema.parse(req.body);
      
      if (data.deckId) {
        const deck = await db.deck.findFirst({ where: { id: data.deckId, userId } });
        if (!deck) return res.status(404).json({ error: "Deck not found" });
      }
      
      const goal = await db.studyGoal.create({
        data: {
          deckId: data.deckId || null,
          cadence: data.cadence,
          targetCount: data.targetCount,
          targetAccuracy: data.targetAccuracy ?? 80,
          deadline: data.deadline ? new Date(data.deadline) : null,
        },
        include: { deck: true }
      });
      res.status(201).json(goal);
    } catch (error) {
      console.error("Error creating goal:", error);
      res.status(400).json({ error: "Failed to create goal" });
    }
  });

  app.put("/api/goals/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      const schema = z.object({
        cadence: z.enum(['DAILY', 'WEEKLY']).optional(),
        targetCount: z.number().int().positive().optional(),
        targetAccuracy: z.number().int().min(1).max(100).optional().nullable(),
        deadline: z.string().datetime().optional().nullable(),
        status: z.enum(['ACTIVE', 'COMPLETED', 'PAUSED']).optional(),
      });
      const data = schema.parse(req.body);
      
      const existingGoal = await db.studyGoal.findFirst({ 
        where: { id, OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true }
      });
      if (!existingGoal || (existingGoal.deckId && existingGoal.deck?.userId !== userId)) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      const goal = await db.studyGoal.update({
        where: { id },
        data: {
          ...data,
          deadline: data.deadline !== undefined 
            ? (data.deadline ? new Date(data.deadline) : null)
            : undefined,
        },
        include: { deck: true, progress: true }
      });
      res.json(goal);
    } catch (error) {
      console.error("Error updating goal:", error);
      res.status(400).json({ error: "Failed to update goal" });
    }
  });

  app.delete("/api/goals/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      
      const existingGoal = await db.studyGoal.findFirst({ 
        where: { id, OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true }
      });
      if (!existingGoal || (existingGoal.deckId && existingGoal.deck?.userId !== userId)) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      await db.studyGoal.delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting goal:", error);
      res.status(400).json({ error: "Failed to delete goal" });
    }
  });

  // --- Goal Progress ---

  app.get("/api/goals/:goalId/progress", isAuthenticated, async (req, res) => {
    try {
      const { goalId } = req.params;
      const { startDate, endDate } = req.query;
      const userId = getUserId(req);
      
      const goal = await db.studyGoal.findFirst({ 
        where: { id: goalId, OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true }
      });
      if (!goal || (goal.deckId && goal.deck?.userId !== userId)) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      const where: any = { goalId };
      if (startDate || endDate) {
        where.dateBucket = {};
        if (startDate) where.dateBucket.gte = new Date(startDate as string);
        if (endDate) where.dateBucket.lte = new Date(endDate as string);
      }
      
      const progress = await db.goalProgress.findMany({
        where,
        orderBy: { dateBucket: 'desc' }
      });
      res.json(progress);
    } catch (error) {
      console.error("Error fetching goal progress:", error);
      res.status(500).json({ error: "Failed to fetch progress" });
    }
  });

  app.get("/api/goals/progress/today", isAuthenticated, async (req, res) => {
    try {
      const today = startOfDay(new Date());
      const userId = getUserId(req);
      const progress = await db.goalProgress.findMany({
        where: { dateBucket: today, goal: { OR: [{ deck: { userId } }, { deckId: null }] } },
        include: { goal: { include: { deck: true } } }
      });
      res.json(progress.filter(p => p.goal.deckId === null || p.goal.deck?.userId === userId));
    } catch (error) {
      console.error("Error fetching today's progress:", error);
      res.status(500).json({ error: "Failed to fetch today's progress" });
    }
  });

  app.post("/api/goals/:goalId/progress", isAuthenticated, async (req, res) => {
    try {
      const { goalId } = req.params;
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const schema = z.object({
        date: z.string().optional(),
        count: z.number().int().nonnegative().default(1),
        increment: z.boolean().optional().default(false),
      });
      const data = schema.parse(req.body);
      
      const goal = await db.studyGoal.findFirst({ 
        where: { id: goalId, OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true }
      });
      if (!goal || (goal.deckId && goal.deck?.userId !== userId)) {
        return res.status(404).json({ error: "Goal not found" });
      }
      
      const dateBucket = data.date ? startOfDay(new Date(data.date)) : startOfDay(new Date());
      
      // Get current progress before update
      const existingProgress = await db.goalProgress.findUnique({
        where: { goalId_dateBucket: { goalId, dateBucket } }
      });
      const previousCount = existingProgress?.completedCount || 0;
      
      let progress;
      if (data.increment) {
        progress = await db.goalProgress.upsert({
          where: { goalId_dateBucket: { goalId, dateBucket } },
          update: { completedCount: { increment: data.count } },
          create: { goalId, dateBucket, completedCount: data.count }
        });
      } else {
        progress = await db.goalProgress.upsert({
          where: { goalId_dateBucket: { goalId, dateBucket } },
          update: { completedCount: data.count },
          create: { goalId, dateBucket, completedCount: data.count }
        });
      }
      
      // Check if goal target was just reached (award star once per goal per period)
      let starAwarded = false;
      let awardedStar: { id: string; rarity: string; orderIndex: number } | null = null;
      let constellationCompleted = false;
      const newCount = progress.completedCount;
      const targetReached = newCount >= goal.targetCount;
      const wasNotReached = previousCount < goal.targetCount;
      
      if (targetReached && wasNotReached) {
        // Goal just completed - award a star using a transaction
        try {
          const result = await db.$transaction(async (tx) => {
            // Get or create active constellation
            const user = await tx.user.findUnique({ where: { id: userId } });
            let constellation;
            
            if (user?.activeConstellationId) {
              constellation = await tx.constellation.findUnique({
                where: { id: user.activeConstellationId },
                include: { stars: { orderBy: { orderIndex: 'asc' } } }
              });
            }
            
            if (!constellation || constellation.isComplete) {
              constellation = await tx.constellation.create({
                data: { userId, name: "Untitled Constellation" },
                include: { stars: true }
              });
              await tx.user.update({
                where: { id: userId },
                data: { activeConstellationId: constellation.id }
              });
            }
            
            const newOrderIndex = constellation.stars.length + 1;
            
            // Determine rarity
            let rarity: 'NORMAL' | 'BRIGHT' | 'BRILLIANT' = 'NORMAL';
            if (newOrderIndex % 25 === 0) {
              rarity = 'BRILLIANT';
            } else if (newOrderIndex % 10 === 0) {
              rarity = 'BRIGHT';
            }
            
            // Generate random position
            const positionX = 0.1 + Math.random() * 0.8;
            const positionY = 0.1 + Math.random() * 0.8;
            
            const star = await tx.star.create({
              data: {
                constellationId: constellation.id,
                orderIndex: newOrderIndex,
                positionX,
                positionY,
                rarity,
                goalTargetCount: goal.targetCount
              }
            });
            
            let completed = false;
            // Mark constellation complete if it reached 100 stars
            if (newOrderIndex >= 100) {
              await tx.constellation.update({
                where: { id: constellation.id },
                data: { isComplete: true }
              });
              completed = true;
              
              // Create new active constellation
              const newConstellation = await tx.constellation.create({
                data: { userId, name: "Untitled Constellation" }
              });
              await tx.user.update({
                where: { id: userId },
                data: { activeConstellationId: newConstellation.id }
              });
            }
            
            return { star, completed };
          });
          
          starAwarded = true;
          awardedStar = { id: result.star.id, rarity: result.star.rarity, orderIndex: result.star.orderIndex };
          constellationCompleted = result.completed;
        } catch (starError) {
          console.error("Error awarding star:", starError);
          // Star awarding failed - don't report it as awarded
        }
      }
      
      res.json({ 
        ...progress, 
        starAwarded, 
        star: awardedStar,
        constellationCompleted
      });
    } catch (error) {
      console.error("Error updating goal progress:", error);
      res.status(400).json({ error: "Failed to update progress" });
    }
  });

  // --- Reminders ---

  app.get("/api/reminders", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const reminders = await db.reminder.findMany({
        where: { OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true },
        orderBy: { sendAt: 'asc' }
      });
      res.json(reminders.filter(r => r.deckId === null || r.deck?.userId === userId));
    } catch (error) {
      console.error("Error fetching reminders:", error);
      res.status(500).json({ error: "Failed to fetch reminders" });
    }
  });

  app.post("/api/reminders", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        deckId: z.string().uuid().optional().nullable(),
        goalId: z.string().uuid().optional().nullable(),
        message: z.string().optional().nullable(),
        sendAt: z.string().datetime(),
        isRecurring: z.boolean().default(false),
        recurrencePattern: z.string().optional().nullable(),
      });
      const data = schema.parse(req.body);
      
      if (data.deckId) {
        const deck = await db.deck.findFirst({ where: { id: data.deckId, userId } });
        if (!deck) return res.status(404).json({ error: "Deck not found" });
      }
      
      const reminder = await db.reminder.create({
        data: {
          deckId: data.deckId || null,
          goalId: data.goalId || null,
          message: data.message || null,
          sendAt: new Date(data.sendAt),
          isRecurring: data.isRecurring,
          recurrencePattern: data.recurrencePattern || null,
        },
        include: { deck: true }
      });
      res.status(201).json(reminder);
    } catch (error) {
      console.error("Error creating reminder:", error);
      res.status(400).json({ error: "Failed to create reminder" });
    }
  });

  app.put("/api/reminders/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      const schema = z.object({
        message: z.string().optional().nullable(),
        sendAt: z.string().datetime().optional(),
        isRecurring: z.boolean().optional(),
        recurrencePattern: z.string().optional().nullable(),
        isSent: z.boolean().optional(),
      });
      const data = schema.parse(req.body);
      
      const existingReminder = await db.reminder.findFirst({ 
        where: { id, OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true }
      });
      if (!existingReminder || (existingReminder.deckId && existingReminder.deck?.userId !== userId)) {
        return res.status(404).json({ error: "Reminder not found" });
      }
      
      const reminder = await db.reminder.update({
        where: { id },
        data: {
          ...data,
          sendAt: data.sendAt ? new Date(data.sendAt) : undefined,
        },
        include: { deck: true }
      });
      res.json(reminder);
    } catch (error) {
      console.error("Error updating reminder:", error);
      res.status(400).json({ error: "Failed to update reminder" });
    }
  });

  app.delete("/api/reminders/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      
      const existingReminder = await db.reminder.findFirst({ 
        where: { id, OR: [{ deck: { userId } }, { deckId: null }] },
        include: { deck: true }
      });
      if (!existingReminder || (existingReminder.deckId && existingReminder.deck?.userId !== userId)) {
        return res.status(404).json({ error: "Reminder not found" });
      }
      
      await db.reminder.delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting reminder:", error);
      res.status(400).json({ error: "Failed to delete reminder" });
    }
  });

  // --- User Preferences ---

  app.get("/api/preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req)!;
      let prefs = await db.userPreference.findFirst({ where: { userId } });
      if (!prefs) {
        prefs = await db.userPreference.create({ data: { userId } });
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ error: "Failed to fetch preferences" });
    }
  });

  app.put("/api/preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req)!;
      const schema = z.object({
        timezone: z.string().optional(),
        dailyReminderTime: z.string().optional().nullable(),
        dailyReminderEnabled: z.boolean().optional(),
        goalDeadlineAlerts: z.boolean().optional(),
        goalAlertDaysBefore: z.number().optional(),
      });
      const data = schema.parse(req.body);
      
      let prefs = await db.userPreference.findFirst({ where: { userId } });
      if (!prefs) {
        prefs = await db.userPreference.create({ data: { userId, ...data } });
      } else {
        prefs = await db.userPreference.update({
          where: { id: prefs.id },
          data
        });
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(400).json({ error: "Failed to update preferences" });
    }
  });

  // --- Knowledge Constellations ---

  // Helper to get or create active constellation
  async function getOrCreateActiveConstellation(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    
    if (user?.activeConstellationId) {
      const constellation = await db.constellation.findUnique({
        where: { id: user.activeConstellationId },
        include: { stars: { orderBy: { orderIndex: 'asc' } } }
      });
      if (constellation && !constellation.isComplete) {
        return constellation;
      }
    }
    
    // Create new constellation
    const newConstellation = await db.constellation.create({
      data: {
        userId,
        name: "Untitled Constellation"
      },
      include: { stars: true }
    });
    
    await db.user.update({
      where: { id: userId },
      data: { activeConstellationId: newConstellation.id }
    });
    
    return newConstellation;
  }

  // Get all user constellations
  app.get("/api/constellations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const constellations = await db.constellation.findMany({
        where: { userId },
        include: { stars: { orderBy: { orderIndex: 'asc' } } },
        orderBy: { createdAt: 'desc' }
      });
      
      res.json(constellations);
    } catch (error) {
      console.error("Error fetching constellations:", error);
      res.status(500).json({ error: "Failed to fetch constellations" });
    }
  });

  // Get active constellation
  app.get("/api/constellations/active", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const constellation = await getOrCreateActiveConstellation(userId);
      res.json(constellation);
    } catch (error) {
      console.error("Error fetching active constellation:", error);
      res.status(500).json({ error: "Failed to fetch active constellation" });
    }
  });

  // Get single constellation
  app.get("/api/constellations/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const constellation = await db.constellation.findFirst({
        where: { id, userId },
        include: { stars: { orderBy: { orderIndex: 'asc' } } }
      });
      
      if (!constellation) {
        return res.status(404).json({ error: "Constellation not found" });
      }
      
      res.json(constellation);
    } catch (error) {
      console.error("Error fetching constellation:", error);
      res.status(500).json({ error: "Failed to fetch constellation" });
    }
  });

  // Update constellation (name, star positions)
  app.put("/api/constellations/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const schema = z.object({
        name: z.string().optional(),
        stars: z.array(z.object({
          id: z.string().uuid(),
          positionX: z.number().min(0).max(1),
          positionY: z.number().min(0).max(1)
        })).optional()
      });
      const data = schema.parse(req.body);
      
      const existing = await db.constellation.findFirst({ where: { id, userId } });
      if (!existing) {
        return res.status(404).json({ error: "Constellation not found" });
      }
      
      // Update constellation name if provided
      if (data.name !== undefined) {
        await db.constellation.update({
          where: { id },
          data: { name: data.name }
        });
      }
      
      // Update star positions if provided
      if (data.stars && data.stars.length > 0) {
        for (const star of data.stars) {
          await db.star.update({
            where: { id: star.id },
            data: { positionX: star.positionX, positionY: star.positionY }
          });
        }
      }
      
      const updated = await db.constellation.findUnique({
        where: { id },
        include: { stars: { orderBy: { orderIndex: 'asc' } } }
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating constellation:", error);
      res.status(400).json({ error: "Failed to update constellation" });
    }
  });

  // Award a star (called when a goal is completed)
  app.post("/api/constellations/award-star", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      let constellation = await getOrCreateActiveConstellation(userId);
      const currentStarCount = constellation.stars.length;
      
      // If constellation is full (100 stars), it should already be marked complete
      // and a new one should have been created
      if (currentStarCount >= 100) {
        // Mark as complete and create new
        await db.constellation.update({
          where: { id: constellation.id },
          data: { isComplete: true }
        });
        
        constellation = await db.constellation.create({
          data: { userId, name: "Untitled Constellation" },
          include: { stars: true }
        });
        
        await db.user.update({
          where: { id: userId },
          data: { activeConstellationId: constellation.id }
        });
      }
      
      const newOrderIndex = constellation.stars.length + 1;
      
      // Determine rarity
      let rarity: 'NORMAL' | 'BRIGHT' | 'BRILLIANT' = 'NORMAL';
      if (newOrderIndex % 25 === 0) {
        rarity = 'BRILLIANT';
      } else if (newOrderIndex % 10 === 0) {
        rarity = 'BRIGHT';
      }
      
      // Generate random position (avoiding edges, spread nicely)
      const positionX = 0.1 + Math.random() * 0.8;
      const positionY = 0.1 + Math.random() * 0.8;
      
      const star = await db.star.create({
        data: {
          constellationId: constellation.id,
          orderIndex: newOrderIndex,
          positionX,
          positionY,
          rarity
        }
      });
      
      // Check if constellation is now complete
      let justCompleted = false;
      if (newOrderIndex >= 100) {
        await db.constellation.update({
          where: { id: constellation.id },
          data: { isComplete: true }
        });
        justCompleted = true;
        
        // Create new active constellation
        const newConstellation = await db.constellation.create({
          data: { userId, name: "Untitled Constellation" },
          include: { stars: true }
        });
        
        await db.user.update({
          where: { id: userId },
          data: { activeConstellationId: newConstellation.id }
        });
      }
      
      const updatedConstellation = await db.constellation.findUnique({
        where: { id: constellation.id },
        include: { stars: { orderBy: { orderIndex: 'asc' } } }
      });
      
      res.json({ 
        star, 
        constellation: updatedConstellation,
        justCompleted,
        totalStars: newOrderIndex
      });
    } catch (error) {
      console.error("Error awarding star:", error);
      res.status(500).json({ error: "Failed to award star" });
    }
  });

  // Get user constellation settings (active + background)
  app.get("/api/constellation-settings", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { activeConstellationId: true, backgroundConstellationId: true }
      });
      
      res.json({
        activeConstellationId: user?.activeConstellationId || null,
        backgroundConstellationId: user?.backgroundConstellationId || null
      });
    } catch (error) {
      console.error("Error fetching constellation settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Set constellation as background
  app.post("/api/constellation-settings/background", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const schema = z.object({
        constellationId: z.string().uuid().nullable()
      });
      const { constellationId } = schema.parse(req.body);
      
      if (constellationId) {
        const constellation = await db.constellation.findFirst({
          where: { id: constellationId, userId }
        });
        if (!constellation) {
          return res.status(404).json({ error: "Constellation not found" });
        }
      }
      
      await db.user.update({
        where: { id: userId },
        data: { backgroundConstellationId: constellationId }
      });
      
      res.json({ success: true, backgroundConstellationId: constellationId });
    } catch (error) {
      console.error("Error setting background constellation:", error);
      res.status(400).json({ error: "Failed to set background" });
    }
  });

  return httpServer;
}
