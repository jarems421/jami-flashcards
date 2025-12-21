import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { z } from "zod";

// Helper to calculate SM-2
function calculateSm2(
  rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY',
  previousInterval: number,
  previousEase: number,
  previousState: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING'
) {
  let newInterval = previousInterval;
  let newEase = previousEase;
  let newState = previousState;

  if (rating === 'AGAIN') {
    newInterval = 0; // < 1 min (re-queue immediately)
    newState = 'LEARNING';
    newEase = Math.max(1.3, previousEase - 0.2);
  } else if (rating === 'HARD') {
    newInterval = previousState === 'NEW' || previousState === 'LEARNING' ? 1 : Math.max(1, previousInterval * 1.2);
    newEase = Math.max(1.3, previousEase - 0.15);
    newState = 'REVIEW';
  } else if (rating === 'GOOD') {
    newInterval = previousState === 'NEW' || previousState === 'LEARNING' ? 1 : Math.max(1, previousInterval * previousEase);
    newState = 'REVIEW';
  } else if (rating === 'EASY') {
    newInterval = previousState === 'NEW' || previousState === 'LEARNING' ? 4 : Math.max(1, previousInterval * previousEase * 1.3);
    newEase += 0.15;
    newState = 'REVIEW';
  }

  return { newInterval, newEase, newState };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  // --- Decks & Stats ---

  app.get("/api/decks", async (req, res) => {
    const decks = await db.deck.findMany({
      include: {
        _count: {
          select: { cards: true }
        }
      }
    });
    res.json(decks);
  });

  app.get("/api/stats", async (req, res) => {
    const totalCards = await db.card.count();
    const newCards = await db.card.count({ where: { state: 'NEW' } });
    const learningCards = await db.card.count({ where: { state: { in: ['LEARNING', 'RELEARNING'] } } });
    const reviewCards = await db.card.count({ where: { state: 'REVIEW' } });
    
    // Cards due today (or overdue)
    const dueCards = await db.card.count({
      where: {
        dueAt: { lte: new Date() }
      }
    });

    res.json({
      totalCards,
      newCards,
      learningCards,
      reviewCards,
      dueCards
    });
  });

  // --- Cards ---

  app.get("/api/cards/due", async (req, res) => {
    const dueCards = await db.card.findMany({
      where: {
        dueAt: { lte: new Date() }
      },
      include: {
        note: true,
        template: true
      },
      orderBy: {
        dueAt: 'asc'
      },
      take: 50 // Limit batch size
    });
    res.json(dueCards);
  });

  app.post("/api/cards/:id/answer", async (req, res) => {
    const { id } = req.params;
    const { rating } = req.body; // AGAIN, HARD, GOOD, EASY

    if (!['AGAIN', 'HARD', 'GOOD', 'EASY'].includes(rating)) {
      return res.status(400).json({ error: "Invalid rating" });
    }

    try {
      const card = await db.card.findUnique({ where: { id } });
      if (!card) return res.status(404).json({ error: "Card not found" });

      const { newInterval, newEase, newState } = calculateSm2(
        rating, 
        card.intervalDays, 
        card.easeFactor, 
        card.state
      );

      // Calculate next due date
      // interval is in days. If interval is 0, it means "soon" (e.g. 1 minute)
      let nextDue = new Date();
      if (newInterval < 1) {
        nextDue.setMinutes(nextDue.getMinutes() + 1); // 1 min later
      } else {
        nextDue.setDate(nextDue.getDate() + newInterval);
      }

      // Transaction: Update Card + Create Log
      const [updatedCard] = await db.$transaction([
        db.card.update({
          where: { id },
          data: {
            state: newState,
            intervalDays: newInterval,
            easeFactor: newEase,
            dueAt: nextDue,
            lastReviewedAt: new Date(),
            reps: { increment: 1 },
            lapses: rating === 'AGAIN' ? { increment: 1 } : undefined
          }
        }),
        db.reviewLog.create({
          data: {
            cardId: id,
            rating,
            responseTimeMs: 0, // Mock for now
            previousState: card.state,
            newState,
            previousIntervalDays: card.intervalDays,
            newIntervalDays: newInterval
          }
        })
      ]);

      res.json(updatedCard);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to answer card" });
    }
  });

  // --- Notes ---

  app.post("/api/notes", async (req, res) => {
    try {
      const { type, content, tags } = req.body;
      
      // 1. Get default deck
      const deck = await db.deck.findFirst({ where: { name: "Demo" } });
      if (!deck) return res.status(500).json({ error: "Demo deck missing" });

      // 2. Get NoteType
      // Simple logic: we only support "Basic" for now
      const noteType = await db.noteType.findFirst({ where: { name: "Basic" } });
      if (!noteType) return res.status(500).json({ error: "Basic note type missing" });

      // 3. Create Note
      const note = await db.note.create({
        data: {
          deckId: deck.id,
          noteTypeId: noteType.id,
          fields: content, // { Front, Back }
          tags: tags || []
        }
      });

      // 4. Generate Cards (Basic only for now)
      const templates = await db.template.findMany({ where: { noteTypeId: noteType.id } });
      
      // Filter templates? For now, generate for ALL templates linked to this note type
      // (Basic -> 1 card, Basic+Reverse -> 2 cards)
      
      await Promise.all(templates.map(tmpl => {
        return db.card.create({
          data: {
            noteId: note.id,
            deckId: deck.id,
            templateId: tmpl.id,
            state: 'NEW',
            dueAt: new Date(),
            intervalDays: 0,
            easeFactor: 2.5
          }
        });
      }));

      res.json({ success: true, noteId: note.id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create note" });
    }
  });


  // --- Seed ---

  app.post("/api/debug/seed", async (req, res) => {
    try {
      const existingDecks = await db.deck.count();
      if (existingDecks > 0) {
        return res.status(400).json({ error: "Database already seeded" });
      }

      // 1. Create NoteType "Basic"
      const basicType = await db.noteType.create({
        data: {
          name: "Basic",
          fields: ["Front", "Back"],
        },
      });

      // 2. Create Templates
      const basicTemplate = await db.template.create({
        data: {
          id: "basic",
          noteTypeId: basicType.id,
          frontHTML: "{{Front}}",
          backHTML: "{{FrontSide}}<hr id=answer>{{Back}}",
        },
      });

      const reverseTemplate = await db.template.create({
        data: {
          id: "reverse",
          noteTypeId: basicType.id,
          frontHTML: "{{Back}}",
          backHTML: "{{FrontSide}}<hr id=answer>{{Front}}",
        },
      });

      // 3. Create Deck "Demo"
      const deck = await db.deck.create({
        data: {
          name: "Demo",
        },
      });

      // 4. Create One Note with Front/Back
      const note = await db.note.create({
        data: {
          deckId: deck.id,
          noteTypeId: basicType.id,
          fields: { Front: "What is the capital of France?", Back: "Paris" },
          tags: ["geography", "demo"],
        },
      });

      // 5. Generate Cards
      // Card 1: Basic (Front -> Back)
      await db.card.create({
        data: {
          noteId: note.id,
          deckId: deck.id,
          templateId: basicTemplate.id,
          state: "NEW",
          dueAt: new Date(),
          intervalDays: 0,
          easeFactor: 2.5,
        },
      });

      // Card 2: Reverse (Back -> Front) - simulating "reverse enabled" logic
      await db.card.create({
        data: {
          noteId: note.id,
          deckId: deck.id,
          templateId: reverseTemplate.id,
          state: "NEW",
          dueAt: new Date(),
          intervalDays: 0,
          easeFactor: 2.5,
        },
      });

      res.json({ success: true, message: "Database seeded successfully" });
    } catch (error) {
      console.error("Seeding error:", error);
      res.status(500).json({ error: "Failed to seed database" });
    }
  });

  return httpServer;
}
