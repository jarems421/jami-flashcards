import { createDeck } from "@/services/study/decks";
import { createNotebook, createNotebookPage } from "@/services/study/notebooks";

/**
 * The things Tutor can make in the app, done exactly as the app's own buttons
 * do them, under the student's own sign-in and security rules.
 */

/** An empty deck, in the conversation's folder when it has one. */
export async function createDeckFromTutor(userId: string, input: { name: string; folderId?: string }) {
  return createDeck(userId, input.name, input.folderId ? { folderIds: [input.folderId] } : {});
}

/** A blank notebook in the folder, with its first page, as "Create notebook" makes one. */
export async function createNotebookFromTutor(userId: string, input: { title: string; folderId: string }) {
  const notebook = await createNotebook(userId, {
    folderId: input.folderId,
    title: input.title,
    type: "blank",
  });
  await createNotebookPage(userId, {
    notebookId: notebook.id,
    folderId: input.folderId,
    pageNumber: 1,
    pageType: "free_working",
    title: "Page 1",
  });
  return notebook;
}
