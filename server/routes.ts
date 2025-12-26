import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { parseCloze } from "../shared/cloze";
import { z } from "zod";
import { startOfDay, endOfDay } from "date-fns";
import { isAuthenticated } from "./replit_integrations/auth";

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

  // --- Queue Logic ---
  
  app.get("/api/queue/today", isAuthenticated, async (req, res) => {
    try {
      const { deckId, deckIds, limit: queryLimit } = req.query;
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

      const whereDeck = deckIdList.length > 0
        ? { deckId: { in: deckIdList }, deck: { userId } } 
        : { deck: { userId } };
      
      const cards = await db.card.findMany({
        where: whereDeck,
        orderBy: [
          { lastReviewedAt: { sort: 'asc', nulls: 'first' } }
        ],
        take: cardLimit,
        include: { note: true, template: true }
      });

      const totalCards = await db.card.count({ where: whereDeck });
      const newCards = await db.card.count({ where: { ...whereDeck, state: 'NEW' } });
      const studiedCards = await db.card.count({ where: { ...whereDeck, state: 'STUDIED' } });
      
      const studiedToday = await db.reviewLog.count({
        where: {
          reviewedAt: { gte: todayStart },
          card: { deck: { userId }, ...(deckIdList.length > 0 ? { deckId: { in: deckIdList } } : {}) }
        }
      });

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
      const { name, parentDeckId } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const userId = getUserId(req);

      const deck = await db.deck.create({
        data: {
          name,
          userId,
          parentDeckId: parentDeckId || null
        }
      });
      res.json(deck);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create deck" });
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
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
        const count = logs.filter(l => l.reviewedAt.toISOString().split('T')[0] === dateStr).length;
        history.push({ date: dayName, reviews: count, fullDate: dateStr });
      }

      res.json({
        totalCards,
        newCards,
        studiedCards,
        accuracy,
        streak,
        timeSpent,
        dailyHistory: history,
        correctAnswers: correctReviews,
        wrongAnswers: totalReviews - correctReviews
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // --- Cards ---

  app.get("/api/cards", isAuthenticated, async (req, res) => {
    try {
      const { deckId } = req.query;
      const userId = getUserId(req);
      const cards = await db.card.findMany({
        where: deckId 
          ? { deckId: deckId as string, deck: { userId } } 
          : { deck: { userId } },
        include: {
          note: true,
          template: true
        },
        orderBy: { note: { createdAt: 'desc' } },
        take: 100 
      });
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
      
      if (data.increment) {
        const progress = await db.goalProgress.upsert({
          where: { goalId_dateBucket: { goalId, dateBucket } },
          update: { completedCount: { increment: data.count } },
          create: { goalId, dateBucket, completedCount: data.count }
        });
        res.json(progress);
      } else {
        const progress = await db.goalProgress.upsert({
          where: { goalId_dateBucket: { goalId, dateBucket } },
          update: { completedCount: data.count },
          create: { goalId, dateBucket, completedCount: data.count }
        });
        res.json(progress);
      }
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
      let prefs = await db.userPreference.findFirst();
      if (!prefs) {
        prefs = await db.userPreference.create({ data: {} });
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ error: "Failed to fetch preferences" });
    }
  });

  app.put("/api/preferences", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        timezone: z.string().optional(),
        dailyReminderTime: z.string().optional().nullable(),
        emailReminders: z.boolean().optional(),
        inAppReminders: z.boolean().optional(),
      });
      const data = schema.parse(req.body);
      
      let prefs = await db.userPreference.findFirst();
      if (!prefs) {
        prefs = await db.userPreference.create({ data });
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

  return httpServer;
}
