import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

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
