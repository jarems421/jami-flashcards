/**
 * A drafted catalogue, printed so it can be read against the specification.
 *
 * Topic and concept lists are checked by a person comparing them with the
 * published subject content, and until then they serve nobody. That check is
 * the only thing standing between a drafted list and a student being told the
 * board examines something it does not, so it needs the list in front of it --
 * not a TypeScript file.
 *
 * Set texts print the same way, for the same reason: naming a text the board
 * does not set would offer a student practice they cannot sit.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/catalogue-list.ts [--spec=8035]
 *
 * Nothing here writes anything. Say the word once you have read a list and it
 * can be marked checked.
 */
import { examSetTextCatalogue } from "@/lib/practice/exam-set-texts";
import { examSpecificationConceptCatalogue } from "@/lib/practice/exam-specification-concepts";
import { examSpecificationTopicCatalogue } from "@/lib/practice/exam-specification-topics";

const DRAFTED = ["8035", "1BS0", "1FR0"];

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

function printSpecification(specificationId: string) {
  const topics = examSpecificationTopicCatalogue(specificationId);
  const concepts = examSpecificationConceptCatalogue(specificationId);
  if (!topics) return;
  console.log(`\n${"=".repeat(72)}\n${specificationId}  ${topics.verified ? "CHECKED" : "NOT YET CHECKED"}`);
  console.log(`source: ${topics.source}\n`);
  for (const topic of topics.topics) {
    const beneath = (concepts?.concepts ?? []).filter((concept) => concept.parentTopicId === topic.id);
    console.log(`  ${topic.label}`);
    for (const concept of beneath) {
      console.log(`      ${concept.reference ? `${concept.reference} ` : ""}${concept.label}`);
    }
    if (beneath.length === 0) console.log("      (the board prints no headings beneath this one)");
  }
  console.log(`\n  ${topics.topics.length} topics, ${concepts?.concepts.length ?? 0} concepts`);
}

function printSetTexts(specificationId: string) {
  const catalogue = examSetTextCatalogue(specificationId);
  if (!catalogue) return;
  console.log(`\n${"=".repeat(72)}\n${specificationId} set texts  ${catalogue.verified ? "CHECKED" : "NOT YET CHECKED"}`);
  console.log(`source: ${catalogue.source}\n`);
  let choice = "";
  for (const text of catalogue.texts) {
    if (text.choice !== choice) {
      choice = text.choice;
      console.log(`  ${choice} (paper ${text.componentCode})`);
    }
    const author = text.author ? ` — ${text.author}` : "";
    const note = text.note ? `  [${text.note}]` : "";
    console.log(`      ${text.label}${author}${note}`);
  }
  console.log(`\n  ${catalogue.texts.length} set texts`);
}

export default function main(args: string[] = []) {
  const only = flag(args, "spec");
  for (const specificationId of only ? [only] : DRAFTED) printSpecification(specificationId);
  if (!only || only === "8702") printSetTexts("8702");
  console.log("\nNothing was written. These lists serve nobody until a person has checked them.");
}
