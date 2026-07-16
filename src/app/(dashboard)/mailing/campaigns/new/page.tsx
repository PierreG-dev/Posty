import { redirect } from "next/navigation";
import { createCampaign } from "@/modules/mailing/repositories/campaigns-repo";

export const dynamic = "force-dynamic";

// Page « nouvelle campagne » = crée un brouillon vide puis redirige sur
// l'éditeur /[id]. Évite le pattern « formulaire flottant sans identité »,
// qui casse quand on veut prévisualiser ou enfiler (qui nécessitent un id).
export default async function NewCampaignPage() {
  const created = await createCampaign({
    name: `Campagne du ${new Date().toLocaleDateString("fr-FR")}`,
    subject: "Nouveau sujet",
    body: "À rédiger.",
    blockIds: [],
    targetCompanyIds: [],
  });
  redirect(`/mailing/campaigns/${created._id}`);
}
