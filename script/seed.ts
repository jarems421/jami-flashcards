import { db } from "../server/db";

async function seed() {
  console.log("Seeding database...");
  try {
    // Always ensure Basic NoteType exists
    let basicType = await db.noteType.findFirst({ where: { name: "Basic" } });
    if (!basicType) {
      console.log("Creating Basic note type...");
      basicType = await db.noteType.create({
        data: {
          name: "Basic",
          fields: ["Front", "Back"],
        },
      });
    }

    // Always ensure templates exist
    const basicTemplate = await db.template.findFirst({ where: { id: "basic" } });
    if (!basicTemplate) {
      console.log("Creating basic template...");
      await db.template.create({
        data: {
          id: "basic",
          noteTypeId: basicType.id,
          frontHTML: "{{Front}}",
          backHTML: "{{FrontSide}}<hr id=answer>{{Back}}",
        },
      });
    }

    const reverseTemplate = await db.template.findFirst({ where: { id: "reverse" } });
    if (!reverseTemplate) {
      console.log("Creating reverse template...");
      await db.template.create({
        data: {
          id: "reverse",
          noteTypeId: basicType.id,
          frontHTML: "{{Back}}",
          backHTML: "{{FrontSide}}<hr id=answer>{{Front}}",
        },
      });
    }

    console.log("Database seeded successfully");
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

seed();
