import { db } from "../server/db";

async function seed() {
  console.log("Seeding database...");
  try {
    const existingDecks = await db.deck.count();
    if (existingDecks > 0) {
      console.log("Database already seeded. Skipping.");
      return;
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

    console.log("Database seeded successfully");
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

seed();
