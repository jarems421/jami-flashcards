import { redirect } from "next/navigation";

type DeckRedirectPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DeckRedirectPage({
  params,
}: DeckRedirectPageProps) {
  const { id } = await params;
  redirect(`/dashboard/decks/${encodeURIComponent(id)}`);
}
